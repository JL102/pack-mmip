const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const { platform } = require('os');
var archiver, openExplorer;

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

try {
	archiver = require('archiver');
	openExplorer = require('open-file-explorer');
	require('colors');
}
catch (err) {
	console.log('Could not find dependencies. Try going to the installation directory and running "npm install".')
	process.exit(0);
}

var autoAnswerYes = false, openAfterComplete = false, showAfterComplete = false, debug = false;

if (process.env.NODE_ENV == 'debug') debug = true;

if (debug) console.log(process.argv);

//duplicate process.argv
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
			case '-d':
			case '--debug':
				debug = true;
				args.splice(i, 1);
				i--;
				break;
			case 'help':
			case '-help':
			case '--help':
				printHelp();
				process.exit(0);
			default:
				console.log(`Unrecognized argument ${arg}. Run pack-mmip --help.`);
				process.exit(0);
		}
	}
}

var dirCalled = args[0];
var dirToArchive = args[1];
var pathToExtension = args[2];

if (debug) console.log(`argv=${JSON.stringify(process.argv)}`);
if (debug) console.log(`args=${JSON.stringify(args)}`);

if (!dirCalled) {
	console.log('dirCalled is undefined. You must run this script from the provided batch file.');
	process.exit(1);
}

if (!dirToArchive) {
	let printStr = 'USAGE: \n\tpack-mmip (path to directory) ([optional] path to packed extension OR just its name) (options)\nFor more help, run "pack-mmip -help"';
	console.log(printStr);
	process.exit(1);
}

/*
// If there are spaces in dirToArchive, Node will screw up with parsing the arguments.
// pack-mmip "./foo bar/" baz will cause process.argv[3] to be '.\\foo bar" baz'
//	This one handles if you used doublequotes
if (dirToArchive.includes('\"')) {
	let split = dirToArchive.split('\"');
	if (debug) console.log("There is a space in the dirToArchive argument; Attempting to parse the correct arguments");
	dirToArchive = split[0];
	pathToExtension = ('' + split[1]).trim(); // trim because it might include spaces
}
//	This one handles if you used singlequotes
else if (dirToArchive.includes('\'')) {
	let split = dirToArchive.split('\'');
	if (debug) console.log("There is a space in the dirToArchive argument; Attempting to parse the correct arguments");
	dirToArchive = split[0];
	pathToExtension = ('' + split[1]).trim(); // trim because it might include spaces
}
*/

if (debug) console.log(`dirToArchive = "${dirToArchive}"; pathToExtension = "${pathToExtension}"`);

// if no path to extension is specified, then we can give it the same name as the directory
if (!pathToExtension) {
	pathToExtension = dirToArchive;
}

//	===	===	===	===	===

var pathToArchive = path.resolve(dirToArchive);
//add .mmip to extension path
if (!pathToExtension.endsWith('.mmip')) {
	pathToExtension = pathToExtension + '.mmip';
}
var resultFilePath = path.resolve(pathToExtension);

//if (debug) console.log(`pathToArchive=${pathToArchive}\nresultFilePath=${resultFilePath}`);

//check if path-to-archive exists
if (!fs.existsSync(pathToArchive)) {
	console.log(`${'Error:'.brightRed} Path "${pathToArchive}" does not exist`);
	process.exit(1);
}

//check if destination is inside dirToArchive
if (resultFilePath.startsWith(pathToArchive + '\\') && !autoAnswerYes) {
	let question = '\nWarning: '.brightRed + 'Destination file is inside the directory that will be archived. This may cause recursive issues. \nProceed? (yes): '
	rl.question(question, (proceed) => {
		
		if (proceed == '' || proceed.toLowerCase().startsWith('y')) {
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
	
	if (showAfterComplete) {
		console.log('Opening parent folder');
		
		//Show parent folder after complete
		let parentPath = path.resolve(resultFilePath, '../');
		//let p = spawn('explorer', [`${resultFilePath},`, '/select']);
		let p1 = spawn('explorer', [parentPath]);
		
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
		'\nAutomatically packs an MMIP extension for MediaMonkey 5.\n\n'
		+ 'USAGE: \n'
		+ '\tpack-mmip (path to directory) ([optional] path to packed extension OR just its name) (options)\n'
		+ 'OPTIONS: \n'
		+ '\t-y \t--Yes \t\t\tAutomatically answer "yes" to prompts\n'
		+ '\t-o \t--OpenAfterComplete\tOpen file (Install to MediaMonkey) after complete\n'
		+ '\t-s \t--ShowAfterComplete\tShow in folder after complete\n'
		+ '\t-d \t--debug\tDebug logs. Please use this if you encounter a bug, and paste the logs into a new GitHub issue.'
		+ '\nIf path to packed extension is not specified, it will default to the name of the folder.\n'
	//+ '\nNOTE: The packed extension will be placed in the directory that this script was called from.';
	console.log(helpStr);
}