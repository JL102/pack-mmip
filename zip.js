const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const archiver = require('archiver');
const glob = require('glob');
const { minimatch } = require('minimatch');
require('colors');

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

module.exports = {
	init(mode) {
		var autoAnswerYes = false, 
			debug = false,
			ignoreConfig = false,
			nameZipInstead = false,
			openAfterComplete = false, 
			putFileIntoBin = false,
			showAfterComplete = false,
			appendVersion = false,
			preambleFilePath,
			licenseFilePath,
			preambleFileContents,
			preambleCommentPatterns = {};
		
		/* === Reading configuration === */
		
		//we have to search for some of our flags first: ignoreConfig, debug, autoAnswerYes, and nameZipInstead
		for (let arg of process.argv) {
			arg = arg.toLowerCase();
			if (arg == '-i' || arg == '--ignoredefault' || arg == '--ignoredefaults') ignoreConfig = true;
			if (arg == '--extension-zip') nameZipInstead = true;
			if (arg === '-y' || arg == '--yes') autoAnswerYes = true;
		}
		
		if (mode === 'zip') nameZipInstead = true;
		
		var configPath;
		if (nameZipInstead) configPath = path.join(__dirname, 'config-pack-zip.json');
		else configPath = path.join(__dirname, 'config-pack-mmip.json');
		
		if (fs.existsSync(configPath) && !ignoreConfig) {
			try {
				//Read configuration file & update default values
				let config = require(configPath);
				openAfterComplete = config.openAfterComplete;
				showAfterComplete = config.showAfterComplete;
				putFileIntoBin = config.putFileIntoBin;
				debug = config.debug;
			}
			catch (err) {
				console.warn('Configuration file is invalid JSON. Deleting & proceeding...');
				fs.unlinkSync(configPath);
			}
		}
		
		// aaand debug has to be read after config is loaded
		for (let arg of process.argv) {
			arg = arg.toLowerCase();
			if (arg === '--debug' || arg === '-d') debug = true;
		}
		
		/* === Argument handling === */
		
		var args = [];
		for (var i = 2; i < process.argv.length; i++) args.push(process.argv[i]);
		
		for (var arg of args) if (arg.includes('\"'))
			console.log(`${'Warning: '.red} Command line arguments may be broken. If you are experiencing issues, try avoiding putting backslashes before quotation marks ("C:\\my directory\\\")`);
		
		//fix broken args which include quotation marks
		for (var i = 0; i < args.length; i++) {
			debugLog(`i=${i}, arg=${args[i]}`);
			var arg = args[i];
			if (arg.includes('\"')) {
				//remove broken arg
				args.splice(i, 1);
				debugLog(`Attempting to fix broken argument: ${arg}`);
				debugLog('If you are experiencing issues, try avoiding backslashes before quotation marks ("C:\\my directory\\\")');
				//insert split arg back into args
				var split = arg.split('\"');
				debugLog(`split arr = ${JSON.stringify(split)}`);
				//push first argument back into args (which should be a directory that contains spaces)
				args.push(split.splice(0, 1)[0]);
				//there theoretically should only ever be one quotation mark inside the arg, but we'll do a for loop anyways
				for (var itm of split) {
					itm = itm.trim();
					//now, break it up by spaces, because the backslash screwed with our multiple arguments
					var split2 = itm.split(' ');
					debugLog(`split2 arr = ${JSON.stringify(split2)}`);
					for (var itm2 of split2) {
						if (itm2) args.push(itm2);
					}
				}
			}
		}
		
		let alternateTask = null; // alternate task to execute after args have been parsed
		
		for (var i = 0; i < args.length; i++) {
			var arg = args[i];
			//Treat any argument starting with a - as an option
			if (arg.startsWith('-')) {
				switch (arg.toLowerCase()) {
					case '-o':
					case '--openaftercomplete':
						openAfterComplete = true;
						args.splice(i, 1); i--;
						break;
					case '-s':
					case '--showaftercomplete':
						showAfterComplete = true;
						args.splice(i, 1); i--;
						break;
					case '-b':
					case '--putfileintobin':
						putFileIntoBin = true;
						args.splice(i, 1); i--;
						break;
					case '-p':
					case '--preamblefile':
						preambleFilePath = path.resolve(args[i + 1]);
						args.splice(i, 2); i--; // TODO might need to be -= 2?
						break;
					case '-l':
					case '--licensefile':
						licenseFilePath = path.resolve(args[i + 1]);
						args.splice(i, 2); i--;
						break;
					case '-a':
					case '--appendversion':
						appendVersion = true;
						args.splice(i, 1); i--;
						break;
					//just have to splice these args; we already set nameZipInstead, ignoreConfig, autoAnswerYes, and debug earlier
					case '-d':
					case '--debug':
					case '--extension-zip':
					case '-i':
					case '--ignoreconfig':
					case '-y':
					case '--yes':
						args.splice(i, 1); i--;
						break;
					case '-config':
					case '--config':
						args.splice(i, 1); i--;
						alternateTask = runConfiguration;
						break;
					case '-create-symlink':
					case '--create-symlink':
						args.splice(i, 1); i--;
						alternateTask = runCreateSymlink;
						break;
					case '-init':
					case '--init':
					case '-init-project':
					case '--init-project':
						alternateTask = runInitProject;
						break;
					case '-help':
					case '--help':
						printHelp();
						process.exit(0);
					case '-v':
					case '--version':
						printVersion();
						process.exit(0);
					default:
						if (arg.toLowerCase().startsWith('--preamble-')) {
							let preamblePattern = args[i + 1];
							debugLog(`Parsing preamble: ${arg}, ${preamblePattern}`);
							let fileExt = arg.split('--preamble-')[1];
							preambleCommentPatterns[fileExt] = preamblePattern;
							args.splice(i, 2);
							i--;
						}
						else {
							console.log(`Unrecognized argument ${arg}. Run pack-mmip --help.`);
							process.exit(0);
						}
				}
			}
			//special case for "pack-mmip config"
			else if (arg == 'config') {
				alternateTask = runConfiguration;
			}
			else if (arg == 'init') {
				alternateTask = runInitProject;
			}
			//special case for "pack-mmip help"
			else if (arg == 'help') {
				printHelp();
				process.exit(0);
			}
		}
		
		debugLog(`args=${JSON.stringify(args)}`);
		debugLog(`preamblePath=${preambleFilePath}`);
		
		if (preambleFilePath) {
			// Preamble specified but no files to add it to
			if (Object.keys(preambleCommentPatterns).length === 0) {
				console.error('\nError: '.brightRed + 'Preamble file path was specified but no file extensions and comment patterns were specified.');
				console.log('Example: ' + '--preamblefile preamble.txt --preamble-js '.brightGreen + 
					'"/* %s */"'.brightBlue + ' --preamble-html '.brightGreen + '"<!-- %s -->"'.brightBlue);
				process.exit(0);
			}
			else if (fs.existsSync(preambleFilePath)) {
				console.log(`Adding preamble from ${preambleFilePath.brightYellow} to the following file extensions: ${Object.keys(preambleCommentPatterns).join(', ').brightYellow}`);
				preambleFileContents = fs.readFileSync(preambleFilePath, {encoding: 'utf-8'});
			}
			else {
				console.error('\nError: '.brightRed + 'Preamble file does not exist: ' + preambleFilePath.brightYellow);
				process.exit(0);
			}
		}
		
		// Perform alternate task
		if (alternateTask) {
			alternateTask();
		}
		// Default task (packing MMIP!)
		else {
			
			/* === Path-related arguments === */
		
			var dirCalled = process.cwd();
			var dirToArchive = args[0];
			var pathToOutput = args[1];
		
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
			if (appendVersion) {
				try {
					let infoJson = require(path.join(pathToArchive, 'info.json'));
					pathToOutput += '-' + infoJson.version;
				}
				catch (err) {
					debugError(err);
					console.log('Error: '.brightRed + 'Could not read info.json to append the addon version');
				}
			}
			// add .zip to extension if we're doing zip instead of mmip
			if (nameZipInstead && !pathToOutput.endsWith('.zip')) pathToOutput += '.zip';
			// otherwise, add .mmip to extension
			else if (!pathToOutput.endsWith('.mmip') && !nameZipInstead) pathToOutput = pathToOutput + '.mmip';
		
			var resultFilePath = path.resolve(pathToOutput);
		
			//put result file into a "bin" subfolder
			if (putFileIntoBin) {
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
		
			//check if path-to-archive exists
			if (!fs.existsSync(pathToArchive)) {
				console.log(`${'Error:'.brightRed} Path "${pathToArchive}" does not exist`);
				process.exit(1);
			}
		
			//next step: check if file exists
			checkExists();
		}
		
		//check if destination file already exists
		function checkExists() {
			if (fs.existsSync(resultFilePath) && !autoAnswerYes) {
			
				let question = '\nWarning: '.red + resultFilePath + ' already exists.' + '\nOverwrite? (yes): ';
				rl.question(question, (overwrite) => {
			
					if (overwrite == '' || overwrite.toLowerCase().startsWith('y')) {
						//begin archiving process
						begin();
					}
					else {
						rl.close();
					}
				});
			}
			else {
				//begin archiving process
				begin();
			}
		}
		
		function getFileListWithIgnore(pathToArchive, resultFilePath) {
			return new Promise(async (resolve, reject) => {
				
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
				
				console.log(`Ignoring the following file(s): ${(ignoreGlobs.join(', ')).brightYellow}`);
				
				var filteredMatches = [];
				
				// for some reason, glob doesn't like it when using Windows separator
				glob.glob(path.join(pathToArchive, '**').split(path.sep).join(path.posix.sep))
					.then(matches => {
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
						console.log(`${String(matches.length - filteredMatches.length - 1).brightYellow} files skipped.\n`);
						
						resolve(filteredMatches);
					})
					.catch(reject);
			})
		}
		
		/* === Finally, begin archiving process === */
		
		function begin() {
			console.log(`\nGoing to zip: ${pathToArchive.brightYellow}`);
			console.log(`Destination: ${resultFilePath.brightYellow}\n`);
			
			// create a file to stream archive data to.
			var output = fs.createWriteStream(resultFilePath);
			
			var archive = archiver('zip', {
				zlib: { level: -1 }, // -1: Default compression level
			});
		
			// listen for all archive data to be written
			// 'close' event is fired only when a file descriptor is involved
			output.on('close', function () {
				var size = archive.pointer();
				var sizeKB = size / 1000;
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
			
			getFileListWithIgnore(pathToArchive, resultFilePath)
			.catch(err => {
				console.error(err);
				process.exit(1);
			})
			.then(paths => {
				
				for (let file of paths) {
					debugLog(file);
					
					let ext = path.extname(file).substring(1); // File extension without the dot
					if (preambleFileContents && preambleCommentPatterns.hasOwnProperty(ext)) {
						debugLog('Adding preamble');
						let preamble = preambleCommentPatterns[ext].replace('%s', preambleFileContents);
						let contents = preamble + '\n\n' + fs.readFileSync(file, {encoding: 'utf-8'});
						archive.append(contents, {name: path.relative(pathToArchive, file)});
					}
					else {
						archive.file(file, {name: path.relative(pathToArchive, file)});
					}
				}
				
				// Add license file to root of archive
				if (licenseFilePath) {
					debugLog(`Adding license file: ${licenseFilePath}`);
					archive.file(licenseFilePath, {name: path.basename(licenseFilePath)});
				}
				
				// finalize the archive (ie we are done appending files but streams have to finish yet)
				// 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
				archive.finalize();
			});
		}
		
		function finish() {
			
			var fileStats = fs.statSync(resultFilePath);
			console.log('Double checking file size: ' + fileStats.size / 1000 + ' KiB');
			
			if (showAfterComplete) {
				console.log('Opening parent folder');
				
				//Show parent folder after complete
				let p1 = spawn('explorer', [`${resultFilePath},`, '/select'], { windowsVerbatimArguments: true });
				
				p1.on('error', (err) => {
					p1.kill();
					console.error(err);
				});
			}
			
			if (openAfterComplete) {
				console.log('Opening file');
				
				//Open file after complete
				let p2 = spawn('explorer', [resultFilePath]);
				
				p2.on('error', (err) => {
					p2.kill();
					console.error(err);
				});
			}
			
			//close readline interface
			rl.close();
		}
		
		function printHelp() {
			
			let command = ((nameZipInstead) ? ' pack-zip' : 'pack-mmip').brightYellow;
			let helpHeader = (nameZipInstead) ? 
				'Automatically packs a folder into a ZIP file. (an extra utility of pack-mmip)' : 
				'Automatically packs an MMIP extension for MediaMonkey.';
			
			let helpStr =
				'\n'+helpHeader+'\n\n'
				+ 'USAGE: \n'
				+ '\t'+command+' <path to project> <[optional] path to packed extension OR just its name> <options>\n'
				+ 'OPTIONS: \n'
				+ '\t-a \t--AppendVersion'.brightCyan+'\t\tRead the project\'s version from its info.json and append it to the\n\t\t\t\t\tfilename. For example: MyAddon-1.2.3.mmip\n'
				+ '\t-b \t--PutFileIntoBin'.brightCyan+'\tPut resulting file into a subfolder named "bin"\n'
				+ '\t-d \t--Debug'.brightCyan+'\t\t\tDebug logs. Please use this if you encounter a bug, and paste the\n\t\t\t\t\tlogs into a new GitHub issue.\n'
				+ '\t-h \t--help'.brightCyan+'\t\t\tPrint this help text and exit\n'
				+ '\t-i \t--IgnoreDefaults'.brightCyan+'\tIgnore configuration rules\n'
				+ '\t-o \t--OpenAfterComplete'.brightCyan+'\tOpen file (Install to MediaMonkey) after complete\n'
				+ '\t-s \t--ShowAfterComplete'.brightCyan+'\tShow in folder after complete\n'
				+ '\t-v \t--version'.brightCyan+'\t\tPrint version and exit\n'
				+ '\t-y \t--Yes'.brightCyan+'\t\t\tAutomatically answer "yes" to prompts\n'
				+ '\n'
				+ '\t-p \t--PreambleFile <name>'.brightCyan+'\tFile containing a preamble to be added to the top of text files.\n'
				+ '\t--preamble-<filetype> <pattern>'.brightCyan+'\tPattern for the preamble to be inserted into files of the specified\n\t\t\t\t\textension, most notably because different types of code have different\n\t\t\t\t\tpatterns for comments. Use '+'%s'.brightYellow+' for where the preamble text should go.\n\t\t\t\t\tFor example: --preamble-js "/* %s */" --preamble-html "<!-- %s -->"'
				+ '\nTO IGNORE CERTAIN FILES:\n'
				+ '\t\t\t\t\tAdd a file named '+'.mmipignore'.brightCyan+' or '+'.archiveignore'.brightCyan+' in your project root.\n\t\t\t\t\tIt uses glob syntax similar to .gitignore\n\t\t\t\t\t(see https://www.npmjs.com/package/glob)\n'
				+ 'TO CONFIGURE DEFAULT BEHAVIOR:\n'
				+ '\t'+command+' config'.brightYellow+'\t\tDifferent configuration files are saved for pack-mmip and pack-zip.\n'
				+ '\nIf path to packed extension is not specified, it will default to the name of the folder.\n'
				+ ((nameZipInstead) ? 
					'The main purpose of this package is the command '+'pack-mmip'.brightYellow+', for packing MMIP extensions for MediaMonkey.\n' : 
					'Additionally comes with a command '+'pack-zip'.brightYellow+' if you wish to use it to output a ZIP file instead of MMIP.\n'
				)
				+ '\nADDITIONAL UTILITIES:\n'
				+ '\t--create-symlink <path>'.brightCyan+'\t\tTool that creates a symbolic link from your install\'s scripts folder to \n\t\t\t\t\tyour project folder, making it easier for development. Just restart\n\t\t\t\t\tMediaMonkey for your changes to take effect, instead of having to\n\t\t\t\t\tre-pack and re-install the addon.\n'
				+ '\t--init'.brightCyan+'\t\t\t\tTool that automatically creates a new info.json file in the current\n\t\t\t\t\tfolder, after prompting for title, ID, version, etc. Similar to `npm init`.'
				// + '\t--init \t--init-project'.brightCyan+'\t\tSimilar to '+'npm init'.brightYellow+', this tool helps initialize an addon project\n\t\t\t\t\tby creating info.json and prompting for each item.'
				//+ '\nNOTE: The packed extension will be placed in the directory that this script was called from.';
			console.log(helpStr);
		}
		
		function printVersion() {
			// Simply read the version from package.json
			let thisPackageJson = require('./package.json');
			console.log(thisPackageJson.version);
		}
		
		async function runInitProject() {
			console.log('This utility will walk you through creating an info.json file.');
			console.log('\nSee `pack-mmip --help` for info on how to use the rest of the tool\'s utilities.');
			console.log('\nPress ^C at any time to quit.\n');
			
			let autoName = path.basename(process.cwd());
			let title, id, description, type, version, author, minAppVersion, iconFile;
			
			title = (await questionWithDefault(`title: (${autoName}) `, autoName));
			let autoId = title.replace(/ /g, '-').replace(/['"()\[\]]/g, '').toLowerCase();
			id = (await questionWithDefault(`id: (${autoId}) `, autoId)).trim();
			description = (await questionWithDefault('description: ', '')).trim();
			type = (await questionWithDefault('type [skin, layout, plugin, views, sync, metadata, visualization, general]: (general) ', 'general')).trim();
			version = (await questionWithDefault('version: (1.0.0) ', '1.0.0')).trim();
			author = (await questionWithDefault('author: ', '')).trim();
			minAppVersion = (await questionWithDefault('minimum compatible MediaMonkey version: (5.0.0) ', '5.0.0')).trim();
			iconFile = (await questionWithDefault('icon file: ', '')).trim();
			
			let newInfoJson = {
				title,
				id,
				description,
				type,
				version,
				author,
				minAppVersion
			};
			
			if (iconFile) newInfoJson.icon = iconFile;
			
			let destination = path.join(process.cwd(), 'info.json');
			let output = JSON.stringify(newInfoJson, null, 4);
			
			questionAllowingAutoYes(output + '\n\nIs this OK? (yes): ', (answer) => {
				if (answer === '' || answer.toLowerCase().startsWith('y')) {
					// write file
					try {
						fs.writeFileSync(destination, output, 'utf-8');
						
						if (autoAnswerYes) {
							console.log(`Wrote to ${destination}:\n\n${output}`);
						}
						else {
							console.log(`Wrote to ${destination}.`);
						}
						rl.close();
					}
					catch (err) {
						console.log(err.toString());
						return rl.close();
					}
				}
			});
			
			function questionWithDefault(question, defaultAns) {
				return new Promise((resolve, reject) => {
					if (autoAnswerYes) resolve(defaultAns);
					else rl.question(question, (answer) => {
						if (answer.trim() === '') {
							resolve(defaultAns);
						}
						else {
							resolve(answer);
						}
					})
				})
			}
		}
		
		function runCreateSymlink() {			
			let defaultDestPath;
			// default to appdata folder
			if (process.env.APPDATA && fs.existsSync(path.join(process.env.APPDATA, 'MediaMonkey5', 'Scripts'))) {
				defaultDestPath = path.join(process.env.APPDATA, 'MediaMonkey5', 'Scripts');
			}
			else {
				defaultDestPath = 'C:\\Program Files (x86)\\MediaMonkey 5\\Scripts';
			}
			
			let target = args[0];
			
			if (!target) {
				console.log(`Please provide the relative path to your project which you want to link to. For example: ${'pack-mmip --create-symlink ./myExtension'.brightCyan}`);
				return rl.close();
			}
			
			let pathToTarget = path.resolve(target);
			if (!fs.existsSync(pathToTarget)) {
				console.log(`Sorry, the provided path (${pathToTarget.brightYellow}) does not exist.`);
				return rl.close();
			}
			// Attempt to read addon ID
			let infoJsonPath = path.join(pathToTarget, 'info.json');
			let infoJson;
			try {
				infoJson = require(infoJsonPath);
				if (!infoJson.id) {
					console.log(`Invalid info.json! Could not find addon ID.`);
					return rl.close();
				}
			}
			catch (err) {
				console.log(`Could not read ${infoJsonPath.brightYellow}!`);
				return rl.close();
			}
			
			let question;
			question = `Please enter the path to your MediaMonkey data folder (leave blank to default to ${defaultDestPath}): `;
			rl.question(question, answer => {
				// Default path: appdata/MM5 or MM5 install folder
				if (!answer || answer.trim() == '') {
					answer = defaultDestPath;
				}
				
				let symlinkBase = path.resolve(answer);
				
				debugLog(path.join(symlinkBase, 'Portable', 'Scripts'));
				
				// Check for 'Portable' subfolder
				if (fs.existsSync(path.join(symlinkBase, 'Portable', 'Scripts'))) {
					debugLog('Switching to Portable/Scripts folder');
					symlinkBase = path.join(symlinkBase, 'Portable', 'Scripts')
				}
				
				if (path.basename(symlinkBase).toLowerCase() != 'scripts') {
					symlinkBase = path.join(symlinkBase, 'Scripts');
					// Special-case 'sorry' message
					if (!fs.existsSync(symlinkBase)) {
						console.log(`Could not find a Scripts folder (${symlinkBase.brightYellow}). Did you enter the right path?`);
						return rl.close();
					}
				}
				
				if (!fs.existsSync(symlinkBase)) {
					console.log(`Sorry, the provided path (${symlinkBase.brightYellow}) does not exist.`);
					return rl.close();
				}
				
				// Process the destination
				
				// let basename = path.basename(pathToTarget);
				let basename = infoJson.id; // addon ID
				let symlinkPath = path.join(symlinkBase, basename);
				
				question = `Create junction at ${symlinkPath.brightYellow} -> ${pathToTarget.brightYellow}? (yes): `
				questionAllowingAutoYes(question, answer => {
					
					if (answer == '' || answer.toLowerCase().startsWith('y')) {
						try {
							fs.symlinkSync(pathToTarget, symlinkPath, 'junction');
							if (autoAnswerYes) console.log(`Created junction at ${symlinkPath.brightYellow} -> ${pathToTarget.brightYellow}.`) // extra information that was provided in the question
							else console.log(`Created junction.`);
							console.log(`Please be careful and do ${'NOT'.brightRed} uninstall the addon from within MediaMonkey. It may result in the contents of your project folder being deleted.`);
							console.log('Instead, delete the junction manually via file explorer.');
						}
						catch (err) {
							console.log(err.toString());
							
							console.log('Could not create junction due to the preceding error. '.brightRed + 'Please delete the target folder/symlink manually and try again.');
							
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
				});
			});
		}
		
		function runConfiguration(){
			var config = {};
			
			if (fs.existsSync(configPath)) {
				let question = 'Configuration already exists.' + '\nOverwrite? (yes): ';
				rl.question(question, (overwrite) => {
					if (overwrite == '' || overwrite.toLowerCase().startsWith('y')) {
						_runConfiguration();
					}
				});
			}
			else {
				_runConfiguration();
			}
			
			function _runConfiguration(){
				//Open after complete
				var question;
				if (nameZipInstead) question = 'Always open files after complete? (Y/N): ';
				else question = 'Always install extension after complete? (Y/N): ';
				questionAllowingAutoYes(question, answer => {
					config.openAfterComplete = (answer.toLowerCase().startsWith('y')) ? true : false;
					//Show after complete
					question = 'Always show in folder after complete? (Y/N): ';
					questionAllowingAutoYes(question, answer => {
						config.showAfterComplete = (answer.toLowerCase().startsWith('y')) ? true : false;
						//Put file into bin
						question = 'Always put files into a subfolder named "bin"? (Y/N): ';
						questionAllowingAutoYes(question, answer => {
							config.putFileIntoBin = (answer.toLowerCase().startsWith('y')) ? true : false;
							//debug
							question = 'Always enable debug mode? (Y/N): ';
							questionAllowingAutoYes(question, answer => {
								config.debug = (answer.toLowerCase().startsWith('y')) ? true : false;
								//Now, write to file
								fs.writeFileSync(configPath, JSON.stringify(config, 0, 2));
								let str = `\nConfiguration saved to ${configPath.yellow}!\n`
									+ `\tOpenAfterComplete: ${String(config.openAfterComplete).toUpperCase()}\n`
									+ `\tShowAfterComplete: ${String(config.showAfterComplete).toUpperCase()}\n`
									+ `\tPutFileIntoBin:    ${String(config.putFileIntoBin).toUpperCase()}\n`
									+ `\tDebug:             ${String(config.debug).toUpperCase()}\n`
								console.log(str);
								rl.close();
							});
						});
					});
				});
			}
		}
		
		/**
		 * Prompt the user with `rl.question` unless autoAnswerYes is enabled. Created as a find-and-replacement for `rl.question` to avoid having to rewrite lots of code :)
		 */
		function questionAllowingAutoYes(question, callback) {
			if (autoAnswerYes) {
				callback('y');
			}
			else {
				rl.question(question, callback);
			}
		}
		
		function debugLog(message) {
			if (debug) console.log(message);
		}
		
		function debugError(message) {
			if (debug) console.error(message);
		}
	}
}