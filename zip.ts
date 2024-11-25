import chalk from 'chalk';
import fs from 'fs';
import { glob } from 'glob';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'path';
import { createInterface } from 'readline/promises';
import { minimatch } from 'minimatch';
import archiver from 'archiver';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
});

const caseInsensitiveArgs = process.argv.map(str => str.startsWith('-') ? str.toLowerCase() : str);

const { values: opts, positionals } = parseArgs({
	args: caseInsensitiveArgs,
	options: {
		appendversion: {
			type: 'boolean',
			short: 'a',
			default: false,
		},
		config: {
			type: 'boolean',
			short: 'c',
			default: false,
		},
		'create-symlink': {
			type: 'boolean',
			short: 'm',
			default: false,
		},
		debug: {
			type: 'boolean',
			short: 'd',
			default: false,
		},
		'extension-zip': {
			type: 'boolean',
			short: 'z',
			default: false,
		},
		help: {
			type: 'boolean',
			default: false,
		},
		/** ignoreConfig */
		ignoredefault: {
			type: 'boolean',
			short: 'i',
			default: false,
		},
		init: {
			type: 'boolean',
			default: false,
		},
		'init-project': {
			type: 'boolean',
			default: false,
		},
		licensefile: {
			type: 'string',
			short: 'l',
		},
		openaftercomplete: {
			type: 'boolean',
			short: 'o',
			default: false,
		},
		preamblefile: {
			type: 'string',
			short: 'p',
		},
		putfileintobin: {
			type: 'boolean',
			short: 'b',
			default: false,
		},
		showaftercomplete: {
			type: 'boolean',
			short: 's',
			default: false,
		},
		version: {
			type: 'boolean',
			short: 'v',
			default: false,
		},
		yes: {
			type: 'boolean',
			short: 'y',
			default: false,
		}
	},
	strict: true,
	allowPositionals: true,
});
let doZipInstead = opts['extension-zip']; // shorthand

positionals.splice(0, 2);
console.log(positionals);

if (opts.version) {
	printVersion();
	process.exit();
}

if (opts.help) {
	printHelp();
	process.exit();
}

type ConfigFile = {
	openAfterComplete: boolean,
	showAfterComplete: boolean,
	putFileIntoBin: boolean,
	debug: boolean,
};

// Load config
const configPath = path.join(__dirname, doZipInstead ? 'config-pack-zip.json' : 'config-pack-mmip.json');
if (fs.existsSync(configPath) && !opts.ignoredefault) {
	try {
		const { openAfterComplete, showAfterComplete, putFileIntoBin, debug } = requireJSON(configPath) as ConfigFile;
		opts.openaftercomplete = !!openAfterComplete || opts.openaftercomplete;
		opts.showaftercomplete = !!showAfterComplete || opts.showaftercomplete;
		opts.putfileintobin = !!putFileIntoBin || opts.putfileintobin;
		opts.debug = !!debug || opts.debug;
	}
	catch (err) {
		debugLog(err);
		console.error('Configuration file is invalid JSON. Deleting & proceeding...');
		fs.unlinkSync(configPath);
	}
}
// End load config

if (opts.config) {
	await runConfiguration();
	process.exit();
}

if (opts['create-symlink']) {
	await runCreateSymlink();
	process.exit();
}

const preambleCommentPatterns = {
	'js': '/* %s */',
	'ts': '/* %s */',
	'html': '<!-- %s -->',
	'less': '// %s',
	'css': '/* %s */',
};

let preambleFileContents: string;
if (opts.preamblefile) {
	if (fs.existsSync(opts.preamblefile)) {
		console.log(`Adding preamble from ${chalk.yellow(opts.preamblefile)} to any source code files`);
		preambleFileContents = fs.readFileSync(opts.preamblefile, { encoding: 'utf-8' });
	}
	else {
		console.error(`\n${chalk.red('Error:')} Preamble file does not exist: ${chalk.yellow(opts.preamblefile)}`);
		process.exit(1);
	}
}

export async function runArchiveTask(type: 'zip' | 'mmip') {
	if (type === 'zip') doZipInstead = true;
	// return;

	const dirCalled = process.cwd();
	// todo: support preamble
	const dirToArchive = positionals[0];
	let pathToOutput = positionals[1];

	if (!dirCalled) {
		// console.error('You must run this script from the provided batch file. [dirCalled is undefined]');
		console.error('Error: Could not find working directory.')
		process.exit(1);
	}

	if (!dirToArchive) {
		printHelp();
		process.exit(1);
	}

	debugLog(`dirToArchive = "${dirToArchive}"; pathToExtension = "${pathToOutput}"`);

	/* === Parsing the paths === */

	var pathToArchive = path.resolve(dirToArchive);

	// if no path to extension is specified, then we can give it the same name as the directory
	if (!pathToOutput) {
		pathToOutput = path.basename(pathToArchive);
	}
	// remove trailing slash from extension path
	if (pathToOutput.endsWith('\\') || pathToOutput.endsWith('/'))
		pathToOutput = pathToOutput.substring(0, pathToOutput.length - 1);

	// Find the addon version and append it to the filename
	if (opts.appendversion) {
		try {
			let infoJSON = requireJSON(path.join(pathToArchive, 'info.json'));
			pathToOutput += '-' + infoJSON.version
		}
		catch (err) {
			debugError(err);
			console.log(chalk.red('Error: ') + 'Could not read info.json to append the addon version');
		}
	}
	// add .zip to extension if we're doing zip instead of mmip
	if (doZipInstead && !pathToOutput.endsWith('.zip')) pathToOutput += '.zip';
	// otherwise, add .mmip to extension
	else if (!pathToOutput.endsWith('.mmip') && !doZipInstead) pathToOutput = pathToOutput + '.mmip';

	let resultFilePath = path.resolve(pathToOutput);

	//put result file into a "bin" subfolder
	if (opts.putfileintobin) {
		let dirname = path.dirname(resultFilePath);
		let basename = path.basename(resultFilePath);

		dirname = path.join(dirname, 'bin');
		resultFilePath = path.join(dirname, basename);

		// If the bin directory does not exist, create it now
		if (!fs.existsSync(dirname)) {
			try {
				fs.mkdirSync(dirname);
			}
			catch (err) {
				console.log(`Couldn't make directory ${dirname}. Were multiple instances of pack-mmip running at the same time?`);
				console.error(err);
			}
		}
	}

	// === Check if destination exists ===

	if (fs.existsSync(resultFilePath)) {
		let overwrite = await questionAllowingAutoYes(
			chalk.red('\nWarning: ') +
			resultFilePath + ' already exists.\nOverwrite? (Y/n): '
		);
		if (!overwrite) {
			rl.close(); // exit
		};
	}

	// === Begin archiving process ===
	console.log(`\nGoing to zip: ${chalk.yellow(pathToArchive)}`);
	console.log(`Destination: ${chalk.yellow(resultFilePath)}\n`);

	const output = fs.createWriteStream(resultFilePath);

	const archive = archiver('zip', {
		zlib: { level: -1 } // -1: default compression level
	});


	// listen for all archive data to be written
	// 'close' event is fired only when a file descriptor is involved
	output.on('close', function () {
		const size = archive.pointer();
		const sizeKB = size / 1000;
		console.log(`Done. Total size: ${sizeKB.toFixed(2)} KiB`);

		finish();
	});

	output.on('error', err => {
		console.log('Could not write to file. Is it open in another program? (WriteStream output error)');
		process.exit(1);
	})

	// good practice to catch warnings (ie stat failures and other non-blocking errors)
	archive.on('warning', function (err) {

		console.log('archive warning: ');

		if (err.code === 'ENOENT') {
			// log warning
			console.log(err);
		} else {
			console.log(err);
		}
	});

	// good practice to catch this error explicitly
	archive.on('error', function (err) {
		console.log('Could not write to file. Is it open in another program? (archiver error)');
		debugError(err);
		process.exit(1);
	});

	// pipe archive data to the file
	archive.pipe(output);

	try {
		const paths = await getFileListWithIgnore(pathToArchive, resultFilePath);
		for (let file of paths) {
			debugLog(file);

			let ext = path.extname(file).substring(1); // File extension without the dot
			let fileContents = fs.readFileSync(file, { encoding: 'utf-8' });
			if (preambleFileContents && ext in preambleCommentPatterns) {
				debugLog('Adding preamble');
				// @ts-ignore
				let pattern = preambleCommentPatterns[ext];
				let preamble = pattern.replace('%s', preambleFileContents);
				let contents = preamble + '\n\n' + fileContents;
				if (ext === 'js') contents = processJSFile(contents);
				archive.append(contents, { name: path.relative(pathToArchive, file) });
			}
			// case for a JS file without preamble
			else if (ext === 'js') {
				let contents = processJSFile(fileContents);
				archive.append(contents, { name: path.relative(pathToArchive, file) });
			}
			else {
				archive.file(file, { name: path.relative(pathToArchive, file) });
			}
		}

		// Add license file to root of archive
		const license = opts.licensefile;
		if (typeof license === 'string') {
			let licenseFilePath = path.resolve(license);
			debugLog(`Adding license file: ${licenseFilePath}`);
			archive.file(licenseFilePath, { name: path.basename(licenseFilePath) });
		}

		// finalize the archive (ie we are done appending files but streams have to finish yet)
		// 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
		archive.finalize();
	}
	catch (err) {
		console.error(err);
		process.exit(1);
	}

	function finish() {

		const fileStats = fs.statSync(resultFilePath);
		debugLog(`Double checking file size: ${fileStats.size / 1000} KiB`);

		if (opts.showaftercomplete) {
			console.log('Opening parent folder');

			let p1 = spawn('explorer', [`${resultFilePath},`, '/select'], { windowsVerbatimArguments: true });

			p1.on('error', (err) => {
				p1.kill();
				console.error(err);
			});
		}

		if (opts.openaftercomplete) {
			console.log('Opening file');

			//Open file after complete
			let p2 = spawn('explorer', [resultFilePath]);

			p2.on('error', (err) => {
				p2.kill();
				console.error(err);
			});
		}

		rl.close();
	}
}

async function runConfiguration() {
	if (fs.existsSync(configPath)) {
		if (!(await questionAllowingAutoYes('Configuration already exists.\nOverwrite? (Y/n): '))) {
			return console.log('Exiting');
		}
	}
	// open after complete
	let q = doZipInstead ? 'Always open files after complete? (Y/n): ' : 'Always install extension after complete? (Y/n): ';
	let openAfterComplete = await questionAllowingAutoYes(q);
	// show after complete
	let showAfterComplete = await questionAllowingAutoYes('Always show in folder after complete? (Y/n): ');
	// put file in bin
	let putFileIntoBin = await questionAllowingAutoYes('Always put files into a subfolder named "bin"? (Y/n): ');
	// debug
	let debug = await questionAllowingAutoYes('Always enable debug mode? (Y/n): ');

	let config: ConfigFile = {
		openAfterComplete,
		showAfterComplete,
		putFileIntoBin,
		debug,
	};

	let json = JSON.stringify(config, null, 4);
	debugLog('JSON config file to be written:', json);

	fs.writeFileSync(configPath, json);
}

function printVersion() {
	// Simply read the version from package.json
	let thisPackageJson = requireJSON('./package.json');
	console.log(thisPackageJson.version);
}

function debugLog(...args: unknown[]) {
	if (opts.debug) console.log(...args);
}

function debugError(...args: unknown[]) {
	if (opts.debug) console.error(...args);
}

async function questionAllowingAutoYes(question: string) {
	if (opts.yes) {
		return true;
	}
	let answer = await rl.question(question);
	if (answer.trim() == '') return true;
	return answer.trim().toLowerCase().startsWith('y');
}

function requireJSON(path: string) {
	const str = fs.readFileSync(path, 'utf-8');
	return JSON.parse(str);
}

function printHelp() {

	let command = chalk.yellow((doZipInstead) ? ' pack-zip' : 'pack-mmip');
	let helpHeader = (doZipInstead) ?
		'Automatically packs a folder into a ZIP file. (an extra utility of pack-mmip)' :
		'Automatically packs an MMIP extension for MediaMonkey.';

	let helpStr =
		'\n' + helpHeader + '\n\n'
		+ 'USAGE: \n'
		+ '\t' + command + ' <path to project> <[optional] path to packed extension OR just its name> <options>\n'
		+ 'OPTIONS: \n'
		+ chalk.cyan('\t-a \t--AppendVersion') + '\t\tRead the project\'s version from its info.json and append it to the\n\t\t\t\t\tfilename. For example: MyAddon-1.2.3.mmip\n'
		+ chalk.cyan('\t-b \t--PutFileIntoBin') + '\tPut resulting file into a subfolder named "bin"\n'
		+ chalk.cyan('\t-d \t--Debug') + '\t\t\tDebug logs. Please use this if you encounter a bug, and paste the\n\t\t\t\t\tlogs into a new GitHub issue.\n'
		+ chalk.cyan('\t-h \t--help') + '\t\t\tPrint this help text and exit\n'
		+ chalk.cyan('\t-i \t--IgnoreDefaults') + '\tIgnore configuration rules\n'
		+ chalk.cyan('\t-o \t--OpenAfterComplete') + '\tOpen file (Install to MediaMonkey) after complete\n'
		+ chalk.cyan('\t-s \t--ShowAfterComplete') + '\tShow in folder after complete\n'
		+ chalk.cyan('\t-v \t--version') + '\t\tPrint version and exit\n'
		+ chalk.cyan('\t-y \t--Yes') + '\t\t\tAutomatically answer "yes" to prompts\n'
		+ '\n'
		+ chalk.cyan('\t-p \t--PreambleFile <name>') + '\tFile containing a preamble to be added to the top of text files.\n'
		// + chalk.cyan('\t--preamble-<filetype> <pattern>') + '\tPattern for the preamble to be inserted into files of the specified\n\t\t\t\t\textension, most notably because different types of code have different\n\t\t\t\t\tpatterns for comments. Use ' + chalk.yellow('%s') + ' for where the preamble text should go.\n\t\t\t\t\tFor example: --preamble-js "/* %s */" --preamble-html "<!-- %s -->"'
		+ '\nTO IGNORE CERTAIN FILES:\n'
		+ '\t\t\t\t\tAdd a file named ' + chalk.cyan('.mmipignore') + ' or ' + chalk.cyan('.archiveignore') + ' in your project root.\n\t\t\t\t\tIt uses glob syntax similar to .gitignore\n\t\t\t\t\t(see https://www.npmjs.com/package/glob)\n'
		+ 'TO CONFIGURE DEFAULT BEHAVIOR:\n'
		+ '\t' + command + chalk.yellow(' config') + '\t\tDifferent configuration files are saved for pack-mmip and pack-zip.\n'
		+ '\nIf path to packed extension is not specified, it will default to the name of the folder.\n'
		+ ((doZipInstead) ?
			'The main purpose of this package is the command ' + chalk.yellow('pack-mmip') + ', for packing MMIP extensions for MediaMonkey.\n' :
			'Additionally comes with a command ' + chalk.yellow('pack-zip') + ' if you wish to use it to output a ZIP file instead of MMIP.\n'
		)
		+ '\nADDITIONAL UTILITIES:\n'
		+ chalk.cyan('\t--create-symlink <path>') + '\t\tTool that creates a symbolic link from your install\'s scripts folder to \n\t\t\t\t\tyour project folder, making it easier for development. Just restart\n\t\t\t\t\tMediaMonkey for your changes to take effect, instead of having to\n\t\t\t\t\tre-pack and re-install the addon.\n'
		+ chalk.cyan('\t--init') + '\t\t\t\tTool that automatically creates a new info.json file in the current\n\t\t\t\t\tfolder, after prompting for title, ID, version, etc. Similar to `npm init`.'
	// + '\t--init \t--init-project'.brightCyan+'\t\tSimilar to '+'npm init'.brightYellow+', this tool helps initialize an addon project\n\t\t\t\t\tby creating info.json and prompting for each item.'
	//+ '\nNOTE: The packed extension will be placed in the directory that this script was called from.';
	console.log(helpStr);
}

async function getFileListWithIgnore(pathToArchive: string, resultFilePath: string) {

	let ignoreString;
	let ignoreGlobs = ['*.zip', '*.mmip']; // Default ignoreGlobs

	// Search for an ignore file
	for (let ignoreFileName of ['.mmipignore', '.archiveignore']) {
		let ignoreFile = path.join(pathToArchive, ignoreFileName);
		if (fs.existsSync(ignoreFile)) {
			console.log(`Found ignore pattern in ${ignoreFileName}`);

			ignoreString = fs.readFileSync(ignoreFile, 'utf-8');
			ignoreString = ignoreString.replace(/\r/g, '');			// remove carriage return

			ignoreGlobs = ignoreString.split('\n');
			ignoreGlobs.push(ignoreFileName);
			ignoreGlobs.push(path.basename(resultFilePath)); // Add result filename to the ignore list, to avoid recursive issues, so I can turn off that warning
			break;
		}
	}

	console.log(chalk.yellow(`Ignoring the following file(s): ${(ignoreGlobs.join(', '))}`));

	var filteredMatches: string[] = [];

	// for some reason, glob doesn't like it when using Windows separator
	const matches = await glob.glob(path.join(pathToArchive, '**').split(path.sep).join(path.posix.sep))
	var minimatchOpts = {
		matchBase: true,
	}

	for (let match of matches) {
		let doAdd = true;
		// Check if it matches any of the ignore patterns
		for (let glob of ignoreGlobs) {
			if (minimatch(match, glob, minimatchOpts)) {
				doAdd = false;
			}
		}
		if (doAdd) {
			let relativePath = path.relative(pathToArchive, match);
			if (relativePath) filteredMatches.push(match); // to remove the "base folder" match
		}
		else debugLog(`Skipping ${match}`);
	}
	console.log(`${chalk.yellow(String(matches.length - filteredMatches.length - 1))} files skipped.\n`);

	return filteredMatches;
}

// Process compiled TS files
function processJSFile(contents: string) {
	// Remove empty export
	return contents.replace(/^export \{\};?$/gm, '');
}

async function runCreateSymlink() {
	let target = positionals[0];

	if (!target) {
		console.log(`Please provide the relative path to your project which you want to link to. For example: ${chalk.cyan('pack-mmip --create-symlink ./myExtension')}`);
		return rl.close();
	}

	let pathToTarget = path.resolve(target);
	if (!fs.existsSync(pathToTarget)) {
		console.log(`Sorry, the provided path (${chalk.yellow(pathToTarget)}) does not exist.`);
		return rl.close();
	}
	// Attempt to read addon ID
	let infoJsonPath = path.join(pathToTarget, 'info.json');
	let infoJson;
	let isSkin = false;
	try {
		infoJson = requireJSON(infoJsonPath)
		if (!infoJson.id) {
			console.log(`Invalid info.json! Could not find addon ID.`);
			return rl.close();
		}
		if (infoJson.type === 'skin') {
			debugLog('Detected that this addon is a skin! Will attempt to put in Skins folder instead of Scripts.');
			isSkin = true;
		}
	}
	catch (err) {
		console.log(`Could not read ${chalk.yellow(infoJsonPath)}!`);
		return rl.close();
	}
	let subFolder = isSkin ? 'Skins' : 'Scripts'; // change which folder to put in, depending on whether it's a skin or script

	// === END TARGET ===

	let defaultDestPath;
	// default to appdata folder
	if (process.env.APPDATA && fs.existsSync(path.join(process.env.APPDATA, 'MediaMonkey5', subFolder))) {
		defaultDestPath = path.join(process.env.APPDATA, 'MediaMonkey5', subFolder);
	}
	else {
		defaultDestPath = `C:\\Program Files (x86)\\MediaMonkey 5\\${subFolder}`;
	}

	let answer = await rl.question(`Please enter the path to your MediaMonkey data folder (leave blank to default to ${defaultDestPath}): `);
	// Default path: appdata/MM5 or MM5 install folder
	if (!answer || answer.trim() == '') {
		answer = defaultDestPath;
	}

	let symlinkBase = path.resolve(answer);

	debugLog(path.join(symlinkBase, 'Portable', subFolder));

	// Check for 'Portable' subfolder
	if (fs.existsSync(path.join(symlinkBase, 'Portable', subFolder))) {
		debugLog(`Switching to Portable/${subFolder} folder`);
		symlinkBase = path.join(symlinkBase, 'Portable', subFolder)
	}

	if (path.basename(symlinkBase).toLowerCase() != subFolder.toLowerCase()) {
		symlinkBase = path.join(symlinkBase, subFolder);
		// Special-case 'sorry' message
		if (!fs.existsSync(symlinkBase)) {
			console.log(`Could not find a ${subFolder} folder (${chalk.yellow(symlinkBase)}). Did you enter the right path?`);
			return rl.close();
		}
	}

	if (!fs.existsSync(symlinkBase)) {
		console.log(`Sorry, the provided path (${chalk.yellow(symlinkBase)}) does not exist.`);
		return rl.close();
	}

	// Process the destination

	// let basename = path.basename(pathToTarget);
	let basename = infoJson.id; // addon ID
	let symlinkPath = path.join(symlinkBase, basename);

	if (await questionAllowingAutoYes(`Create junction at ${chalk.yellow(symlinkPath)} -> ${chalk.yellow(pathToTarget)}? (yes): `)) {
		try {
			fs.symlinkSync(pathToTarget, symlinkPath, 'junction');
			if (opts.yes) console.log(`Created junction at ${chalk.yellow(symlinkPath)} -> ${chalk.yellow(pathToTarget)}.`) // extra information that was provided in the question
			else console.log(`Created junction.`);
			console.log(`Please be careful and do ${chalk.red('NOT')} uninstall the addon from within MediaMonkey. It may result in the contents of your project folder being deleted.`);
			console.log('Instead, delete the junction manually via file explorer.');
		}
		catch (err) {
			console.log(err?.toString());

			console.log(chalk.red('Could not create junction due to the preceding error. ') + 'Please delete the target folder/symlink manually and try again.');

			//Show folder of the target after the error so they can fix it
			let p1 = spawn('explorer', [`${symlinkPath},`, '/select'], { windowsVerbatimArguments: true });

			p1.on('error', (err) => {
				p1.kill();
				console.error(err);
			});
		}
	}
	else {
		console.log('Cancelled.');
	}
	rl.close();
}