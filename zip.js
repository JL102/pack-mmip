const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
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

var dirCalled = process.argv[2];
var dirToArchive = process.argv[3];
var pathToExtension = process.argv[4];

var autoAnswerYes = false, openAfterComplete = false, showAfterComplete = false;

for (var arg of process.argv) {
	switch (arg.toLowerCase()) {
		case '-y':
		case '--yes':
			autoAnswerYes = true;
			break;
		case '-o':
		case '--openaftercomplete':
			openAfterComplete = true;
			break;
		case '-s':
		case '--showaftercomplete':
			showAfterComplete = true;
			break;
		case 'help':
		case '-help':
		case '--help':
			printHelp();
			process.exit(0);
	}
}

//if the first arg is some form of 'help', print help info then exit
if (dirCalled == 'help' || dirCalled == '-help' || dirCalled == '--help') {
	printHelp();
	process.exit(0);
}

if (!dirCalled) {
	console.log('dirCalled is undefined. You must run this script from the provided batch file.');
}

if (!dirToArchive || !pathToExtension) {
	let printStr = 'USAGE: \n\tpack-mmip (path to directory) (path to packed extension OR just its name) (options)\nFor more help, run "pack-mmip -help"';
	console.log(printStr);
	process.exit(0);
}

var pathToArchive = path.resolve(dirToArchive);
//add .mmip to extension path
if (!pathToExtension.endsWith('.mmip')) {
	pathToExtension = pathToExtension + '.mmip';
}
var resultFilePath = path.resolve(pathToExtension);

//check if path-to-archive exists
if (!fs.existsSync(pathToArchive)) {
	console.log(`Error: Path "${pathToArchive}" does not exist`);
	process.exit(0);
}

//check if destination is inside dirToArchive
if (resultFilePath.startsWith(pathToArchive + '\\') && !autoAnswerYes) {
	let question = 'Warning: '.brightRed + 'Destination file is inside the directory that will be archived. This may cause recursive issues. \nProceed? (yes): '
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
	
		let question = 'Warning: '.brightRed + resultFilePath + ' already exists.' + '\nOverwrite? (yes): ';
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
	console.log(`Going to zip: ${pathToArchive.brightYellow}`);
	console.log(`Destination: ${resultFilePath.brightYellow}`);

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

	// good practice to catch warnings (ie stat failures and other non-blocking errors)
	archive.on('warning', function (err) {
		if (err.code === 'ENOENT') {
			// log warning
		} else {
			// throw error
			throw err;
		}
	});

	// good practice to catch this error explicitly
	archive.on('error', function (err) {
		throw err;
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
		+ '\tpack-mmip (path to directory) (path to packed extension OR just its name) (options)\n'
		+ 'OPTIONS: \n'
		+ '\t-y \t--Yes \t\t\tAutomatically answer "yes" to prompts\n'
		+ '\t-o \t--OpenAfterComplete\tOpen file (Install to MediaMonkey) after complete\n'
		+ '\t-s \t--ShowAfterComplete\tShow in folder after complete\n'
	//+ '\nNOTE: The packed extension will be placed in the directory that this script was called from.';
	console.log(helpStr);
}