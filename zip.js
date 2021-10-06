const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const { platform } = require('os');
var archiver;

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

// External dependencies
try {
	archiver = require('archiver');
	require('colors');
}
catch (err) {
	console.log('Could not find dependencies. Try going to the installation directory and running "npm install".')
	process.exit(0);
}

module.exports = {
	init(mode) {
		var autoAnswerYes = false, 
			debug = false,
			ignoreConfig = false,
			nameZipInstead = false,
			openAfterComplete = false, 
			putFileIntoBin = false,
			showAfterComplete = false,
			doingAlternateTask = false,
			doingInitProject = false;
		
		/* === Reading configuration === */
		
		//we have to search for ignoreConfig and nameZipInstead first
		for (var arg of process.argv) {
			if (arg.toLowerCase() == '-i' || arg.toLowerCase() == '--ignoredefault' || arg.toLowerCase() == '--ignoredefaults') ignoreConfig = true;
			if (arg == '--extension-zip') nameZipInstead = true;
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
		
		/* === Argument handling === */
		
		var args = [];
		for (var i = 2; i < process.argv.length; i++) args.push(process.argv[i]);
		
		for (var arg of args) if (arg.includes('\"'))
			console.log(`${'Warning: '.yellow} Command line arguments may be broken. If you are experiencing issues, try avoiding putting backslashes before quotation marks ("C:\\my directory\\\")`);
		
		//fix broken args which include quotation marks
		for (var i = 0; i < args.length; i++) {
			if (debug) console.log(`i=${i}, arg=${args[i]}`)
			var arg = args[i];
			if (arg.includes('\"')) {
				//remove broken arg
				args.splice(i, 1);
				if (debug) console.log(`Attempting to fix broken argument: ${arg}`);
				if (debug) console.log('If you are experiencing issues, try avoiding backslashes before quotation marks ("C:\\my directory\\\")');
				//insert split arg back into args
				var split = arg.split('\"');
				if (debug) console.log(`split arr = ${JSON.stringify(split)}`);
				//push first argument back into args (which should be a directory that contains spaces)
				args.push(split.splice(0, 1)[0]);
				//there theoretically should only ever be one quotation mark inside the arg, but we'll do a for loop anyways
				for (var itm of split) {
					itm = itm.trim();
					//now, break it up by spaces, because the backslash screwed with our multiple arguments
					var split2 = itm.split(' ');
					if (debug) console.log(`split2 arr = ${JSON.stringify(split2)}`);
					for (var itm2 of split2) {
						if (itm2) args.push(itm2);
					}
				}
			}
		}
		
		for (var i = 0; i < args.length; i++) {
			var arg = args[i];
			//Treat any argument starting with a - as an option
			if (arg.startsWith('-')) {
				switch (arg.toLowerCase()) {
					case '-y':
					case '--yes':
						autoAnswerYes = true;
						args.splice(i, 1);
						i--;
						break;
					case '-o':
					case '--openaftercomplete':
						openAfterComplete = true;
						args.splice(i, 1);
						i--;
						break;
					case '-s':
					case '--showaftercomplete':
						showAfterComplete = true;
						args.splice(i, 1);
						i--;
						break;
					case '-b':
					case '--putfileintobin':
						putFileIntoBin = true;
						args.splice(i, 1);
						i--;
						break;
					case '-d':
					case '--debug':
						debug = true;
						args.splice(i, 1);
						i--;
						break;
					case '--extension-zip':
						//just have to splice args; we already set nameZipInstead earlier
						args.splice(i, 1);
						i--;
						break;
					case '-i':
					case '--ignoreconfig':
						//just have to splice args; we already set ignoreConfig earlier
						args.splice(i, 1);
						i--;
						break;
					case '-config':
					case '--config':
						runConfiguration();
						doingAlternateTask = true;
						break;
					case '-create-symlink':
					case '--create-symlink':
						doingAlternateTask = true;
						runCreateSymlink();
						break;
					case '-init':
					case '--init':
					case '-init-project':
					case '--init-project':
						doingAlternateTask = true;
						doingInitProject = true; // in order to support "-y" arguments, we can't run the task immediately and must wait until all arguments are filtered
						break;
					case '-help':
					case '--help':
						printHelp();
						process.exit(0);
					default:
						console.log(`Unrecognized argument ${arg}. Run pack-mmip --help.`);
						process.exit(0);
				}
			}
			//special case for "pack-mmip config"
			else if (arg == 'config') {
				runConfiguration();
				doingAlternateTask = true;
			}
			//special case for "pack-mmip help"
			else if (arg == 'help') {
				printHelp();
				process.exit(0);
			}
		}
		if (debug) console.log(`args=${JSON.stringify(args)}`);
		
		if (doingInitProject) runInitProject();
		
		//only run if we're not doing configuration (hacky, i know, but w/e)
		if (!doingAlternateTask) {
			
			/* === Path-related arguments === */
		
			var dirCalled = process.cwd();
			var dirToArchive = args[0];
			var pathToExtension = args[1];
		
			if (!dirCalled) {
				// console.error('You must run this script from the provided batch file. [dirCalled is undefined]');
				console.error('Error: Could not find working directory.')
				process.exit(1);
			}
		
			if (!dirToArchive) {
				let printStr;
				if (nameZipInstead) printStr = 'USAGE: \n\tpack-zip (path to directory) ([optional] path to packed extension OR just its name) (options)\nFor more help, run "pack-zip -help"';
				else printStr = 'USAGE: \n\tpack-mmip (path to directory) ([optional] path to packed extension OR just its name) (options)\nFor more help, run "pack-mmip -help"';
				console.log(printStr);
				process.exit(1);
			}
		
			if (debug) console.log(`dirToArchive = "${dirToArchive}"; pathToExtension = "${pathToExtension}"`);
		
			// if no path to extension is specified, then we can give it the same name as the directory
			if (!pathToExtension) {
				pathToExtension = dirToArchive;
			}
		
			/* === Parsing the paths === */
		
			var pathToArchive = path.resolve(dirToArchive);
			// remove trailing slash from extension path
			if (pathToExtension.endsWith('\\') || pathToExtension.endsWith('/'))
				pathToExtension = pathToExtension.substring(0, pathToExtension.length - 1);
			// add .zip to extension if we're doing zip instead of mmip
			if (nameZipInstead && !pathToExtension.endsWith('.zip')) pathToExtension += '.zip';
			// otherwise, add .mmip to extension
			else if (!pathToExtension.endsWith('.mmip') && !nameZipInstead) pathToExtension = pathToExtension + '.mmip';
		
			var resultFilePath = path.resolve(pathToExtension);
		
			//put result file into a "bin" subfolder
			if (putFileIntoBin) {
				let dirname = path.dirname(resultFilePath);
				let basename = path.basename(resultFilePath);
				
				dirname = path.join(dirname, 'bin');
				resultFilePath = path.join(dirname, basename);
				
				// If the bin directory does not exist, create it now
				if (!fs.existsSync(dirname)) {
					fs.mkdirSync(dirname);
				}
			}
		
			//check if path-to-archive exists
			if (!fs.existsSync(pathToArchive)) {
				console.log(`${'Error:'.brightRed} Path "${pathToArchive}" does not exist`);
				process.exit(1);
			}
		
			//check if destination is inside dirToArchive
			if (resultFilePath.startsWith(pathToArchive + '\\')) {
				//recursion warning (default no)
				let question = '\nWarning: '.brightRed + 'Destination file is inside the directory that will be archived. This may cause recursive issues. \nProceed? (no): '
				rl.question(question, (proceed) => {
					if (proceed.toLowerCase().startsWith('y')) {
						//next step: check if file exists
						checkExists();
					}
					else {
						rl.close();
					}
				})
			}
			else {
				//next step: check if file exists
				checkExists();
			}
		}
		
		//check if destination file already exists
		function checkExists() {
			if (fs.existsSync(resultFilePath) && !autoAnswerYes) {
			
				let question = '\nWarning: '.brightRed + resultFilePath + ' already exists.' + '\nOverwrite? (yes): ';
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
				process.exit(1);
			});
		
			// pipe archive data to the file
			archive.pipe(output);
		
			// append files from a sub-directory, putting its contents at the root of archive
			archive.directory(pathToArchive, false);
		
			// finalize the archive (ie we are done appending files but streams have to finish yet)
			// 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
			archive.finalize();
		}
		
		function finish() {
			
			var fileStats = fs.statSync(resultFilePath);
			console.log('Double checking file size: ' + fileStats.size / 1000 + ' KiB');
			
			if (showAfterComplete) {
				console.log('Opening parent folder');
				
				//Show parent folder after complete
				let parentPath = path.resolve(resultFilePath, '../');
				let p1 = spawn('explorer', [`${resultFilePath},`, '/select'], { windowsVerbatimArguments: true });
				//let p1 = spawn('explorer', [parentPath]);
				
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
			let helpStr =
				'\nAutomatically packs an MMIP extension for MediaMonkey.\n\n'
				+ 'USAGE: \n'
				+ '\t'+'pack-mmip'.brightYellow+' (path to directory) ([optional] path to packed extension OR just its name) (options)\n'
				+ 'OPTIONS: \n'
				+ '\t-y \t--Yes'.brightCyan+'\t\t\tAutomatically answer "yes" to prompts\n'
				+ '\t-o \t--OpenAfterComplete'.brightCyan+'\tOpen file (Install to MediaMonkey) after complete\n'
				+ '\t-s \t--ShowAfterComplete'.brightCyan+'\tShow in folder after complete\n'
				+ '\t-b \t--PutFileIntoBin'.brightCyan+'\tPut resulting file into a subfolder named "bin"\n'
				+ '\t-d \t--Debug'.brightCyan+'\t\t\tDebug logs. Please use this if you encounter a bug, and paste the logs into a new GitHub issue.\n'
				+ '\t-i \t--IgnoreDefaults'.brightCyan+'\tIgnore configuration rules\n'
				+ '\nTO CONFIGURE DEFAULT BEHAVIOR:\n'
				+ '\tpack-mmip config'.brightYellow+'\t\tDifferent configuration files are saved for pack-mmip and pack-zip.\n'
				+ '\nIf path to packed extension is not specified, it will default to the name of the folder.\n'
				+ 'Additionally comes with a command '+'pack-zip'.brightYellow+' if you wish to use it for zip files instead of just MMIP.\n'
				+ '\nADDITIONAL UTILITIES:\n'
				+ '\t--create-symlink'.brightCyan+'\t\tTool that creates a symbolic link from your install\'s scripts folder to \n\t\t\t\t\tyour project folder, making it easier for development. Just restart\n\t\t\t\t\tMediaMonkey for your changes to take effect, instead of having to\n\t\t\t\t\tre-pack and re-install the addon.\n'
				+ '\t--init \t--init-project'.brightCyan+'\t\tSimilar to '+'npm init'.brightYellow+', this tool helps initialize an addon project\n\t\t\t\t\tby creating info.json and prompting for each item.'
				//+ '\nNOTE: The packed extension will be placed in the directory that this script was called from.';
			console.log(helpStr);
		}
		
		function runInitProject() {
			
		}
		
		function runCreateSymlink() {
			console.log('Creating symlink to project folder');
			
			var question;
			question = 'Please enter the path to your MediaMonkey installation (leave blank to default to C:\\Program Files (x86)\\MediaMonkey 5): ';
			rl.question(question, answer => {
				if (!answer || answer.trim() == '') {
					answer = 'C:\\Program Files (x86)\\MediaMonkey 5\\Scripts';
				}
				
				let symlinkBase = path.resolve(answer);
				
				if (path.basename(symlinkBase).toLowerCase() != 'scripts') {
					symlinkBase = path.join(symlinkBase, 'Scripts');
				}
				
				if (!fs.existsSync(symlinkBase)) {
					console.log(`Sorry, the provided path (${symlinkBase.brightYellow}) does not exist.`);
					return rl.close();
				}
				
				question = 'Please enter the location of your project: ';
				rl.question(question, answer => {
					let target = path.resolve(answer);
					
					if (!fs.existsSync(target)) {
						console.log(`Sorry, the provided path (${target.brightYellow}) does not exist.`);
						return rl.close();
					}
					
					let basename = path.basename(target);
					let symlinkPath = path.join(symlinkBase, basename);
					
					fs.symlinkSync(target, symlinkPath, 'junction');
					console.log(`Created junction at ${symlinkPath.brightYellow} to ${target.brightYellow}.`);
					console.log(`Please be careful and do ${'NOT'.brightRed} tell MediaMonkey to uninstall this addon. It may result in the contents of your project folder being deleted.`);
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
				rl.question(question, answer => {
					config.openAfterComplete = (answer.toLowerCase().startsWith('y')) ? true : false;
					//Show after complete
					question = 'Always show in folder after complete? (Y/N): ';
					rl.question(question, answer => {
						config.showAfterComplete = (answer.toLowerCase().startsWith('y')) ? true : false;
						//Put file into bin
						question = 'Always put files into a subfolder named "bin"? (Y/N): ';
						rl.question(question, answer => {
							config.putFileIntoBin = (answer.toLowerCase().startsWith('y')) ? true : false;
							//debug
							question = 'Always enable debug mode? (Y/N): ';
							rl.question(question, answer => {
								config.debug = (answer.toLowerCase().startsWith('y')) ? true : false;
								//Now, write to file
								fs.writeFileSync(configPath, JSON.stringify(config, 0, 2));
								let str = `Configuration saved!\n`
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
	}
}