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
import chokidar from 'chokidar';
import ts from 'typescript';
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
        'data-folder': {
            type: 'string',
            default: '',
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
        dev: {
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
if (opts.version) {
    printVersion();
    process.exit();
}
if (opts.help) {
    printHelp();
    process.exit();
}
// Load config
const configPath = path.join(__dirname, doZipInstead ? 'config-pack-zip.json' : 'config-pack-mmip.json');
if (fs.existsSync(configPath) && !opts.ignoredefault) {
    try {
        const { openAfterComplete, showAfterComplete, putFileIntoBin, debug } = requireJSON(configPath);
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
if (opts.dev) {
    await RunHostTask();
    process.exit();
}
if (opts.init) {
    await runInitProjectTask();
    process.exit();
}
const preambleCommentPatterns = {
    'js': '/* %s */',
    'ts': '/* %s */',
    'html': '<!-- %s -->',
    'less': '// %s',
    'css': '/* %s */',
};
let preambleFileContents;
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
async function compileFile(program, filePath) {
    const sourceFile = program.getSourceFile(filePath);
    assert(sourceFile, `Source file ${filePath} not in program.`);
    let compiledCode = '';
    const customWriteFile = (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
        if (fileName.endsWith('.js')) {
            compiledCode = data;
        }
    };
    const emitResult = program.emit(sourceFile, customWriteFile);
    // Report diagnostics if any
    emitResult.diagnostics.forEach(diagnostic => {
        if (diagnostic.file) {
            const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            console.error(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
        }
        else {
            console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        }
    });
    assert(!emitResult.emitSkipped, `Emitting ${filePath} failed`);
    return compiledCode;
}
;
export async function runArchiveTask(type) {
    if (type === 'zip')
        doZipInstead = true;
    // return;
    const dirCalled = process.cwd();
    // todo: support preamble
    const dirToArchive = positionals[0];
    let pathToOutput = positionals[1];
    if (!dirCalled) {
        // console.error('You must run this script from the provided batch file. [dirCalled is undefined]');
        console.error('Error: Could not find working directory.');
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
            pathToOutput += '-' + infoJSON.version;
        }
        catch (err) {
            debugError(err);
            console.log(chalk.red('Error: ') + 'Could not read info.json to append the addon version');
        }
    }
    // add .zip to extension if we're doing zip instead of mmip
    if (doZipInstead && !pathToOutput.endsWith('.zip'))
        pathToOutput += '.zip';
    // otherwise, add .mmip to extension
    else if (!pathToOutput.endsWith('.mmip') && !doZipInstead)
        pathToOutput = pathToOutput + '.mmip';
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
        let overwrite = await questionAllowingAutoYes(chalk.red('\nWarning: ') +
            resultFilePath + ' already exists.\nOverwrite? (Y/n): ');
        if (!overwrite) {
            process.exit(0);
        }
        ;
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
    });
    // good practice to catch warnings (ie stat failures and other non-blocking errors)
    archive.on('warning', function (err) {
        console.log('archive warning: ');
        if (err.code === 'ENOENT') {
            // log warning
            console.log(err);
        }
        else {
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
    let program;
    const tsConfigPath = path.join(pathToArchive, 'tsconfig.json');
    if (type === 'mmip' && fs.existsSync(tsConfigPath)) {
        const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
        let parsedCommandLine = ts.parseJsonConfigFileContent(configFile.config, ts.sys, pathToArchive);
        program = ts.createProgram(parsedCommandLine.fileNames, parsedCommandLine.options);
        // Retrieve and log diagnostics before emitting
        const diagnostics = ts.getPreEmitDiagnostics(program);
        let anyErrorsFound = false;
        if (diagnostics.length > 0) {
            diagnostics.forEach(diagnostic => {
                if (diagnostic.file) {
                    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
                    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
                    let relativePath = path.relative(pathToArchive, diagnostic.file.fileName);
                    console.error(`${relativePath} (${line + 1},${character + 1}): ${message}`);
                    anyErrorsFound = true;
                }
                else {
                    console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
                }
            });
        }
        if (anyErrorsFound) {
            // todo: add option to ignore TS errors or turn them into warnings?
            console.error('Some TypeScript errors were found during compilation.');
            process.exit(1);
        }
    }
    try {
        const paths = await getFileListWithIgnore(pathToArchive, resultFilePath);
        for (let file of paths) {
            debugLog(file);
            if (fs.lstatSync(file).isDirectory()) {
                continue;
            }
            let ext = path.extname(file).substring(1); // File extension without the dot
            let relativePath = path.relative(pathToArchive, file);
            // Add the file contents directly instead of archive.file()
            function addContents(contents, name) {
                // add preamble if it's provided
                if (preambleFileContents) {
                    debugLog('Adding preamble');
                    // @ts-ignore
                    let pattern = preambleCommentPatterns[ext];
                    let preamble = pattern.replace('%s', preambleFileContents);
                    contents = preamble + '\n\n' + contents;
                }
                archive.append(contents, { name });
            }
            if (ext === 'ts' && program) {
                debugLog(`Compiling ${file}`);
                let compiledCode = await compileFile(program, file);
                const jsFile = file.replace(/\.ts$/, '.js');
                let contents = processJSFile(compiledCode, relativePath);
                addContents(contents, path.relative(pathToArchive, jsFile));
            }
            else if (ext === 'js') {
                let fileContents = fs.readFileSync(file, { encoding: 'utf-8' });
                let contents = processJSFile(fileContents, relativePath);
                addContents(contents, path.relative(pathToArchive, file));
            }
            else if (ext in preambleCommentPatterns) {
                let fileContents = fs.readFileSync(file, { encoding: 'utf-8' });
                addContents(fileContents, path.relative(pathToArchive, file));
            }
            // if it's not a ts/js file or another text file supporting preamble, just add it as a file
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
    let config = {
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
    let thisPackageJson = requireJSON(path.join(__dirname, 'package.json'));
    console.log(thisPackageJson.version);
}
function debugLog(...args) {
    if (opts.debug)
        console.log(...args);
}
function debugError(...args) {
    if (opts.debug)
        console.error(...args);
}
async function questionWithDefault(question, defaultAns) {
    if (opts.yes)
        return defaultAns;
    let answer = await rl.question(question);
    if (answer.trim() === '') {
        return defaultAns;
    }
    else {
        return answer;
    }
}
async function questionAllowingAutoYes(question) {
    if (opts.yes) {
        return true;
    }
    let answer = await rl.question(question);
    if (answer.trim() == '')
        return true;
    return answer.trim().toLowerCase().startsWith('y');
}
function requireJSON(path) {
    const str = fs.readFileSync(path, 'utf-8');
    return JSON.parse(str);
}
function printHelp() {
    let command = chalk.yellow((doZipInstead) ? ' pack-zip' : 'pack-mmip');
    let helpHeader = (doZipInstead) ?
        'Automatically packs a folder into a ZIP file. (an extra utility of pack-mmip)' :
        'Automatically packs an MMIP extension for MediaMonkey.';
    let helpStr = '\n' + helpHeader + '\n\n'
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
            'The main purpose of this package is the command ' + chalk.yellow('pack-mmip') + ', for packing MMIP extensions for MediaMonkey.' :
            'Additionally comes with a command ' + chalk.yellow('pack-zip') + ' if you wish to use it to output a ZIP file instead of MMIP.\n')
        + (doZipInstead ? '' :
            '\nADDITIONAL UTILITIES:\n'
                // + chalk.cyan('\t--create-symlink <path>') + '\t\tTool that creates a symbolic link from your install\'s scripts folder to \n\t\t\t\t\tyour project folder, making it easier for development. Just restart\n\t\t\t\t\tMediaMonkey for your changes to take effect, instead of having to\n\t\t\t\t\tre-pack and re-install the addon.\n'
                + chalk.cyan('\t--dev <path>') + '\t\t\tTool that temporarily "mounts" your addon to MediaMonkey\'s scripts/\n'
                + chalk.cyan('\t [--data-folder <path>]') + '\t\tskins folder, making development easier. Just restart MediaMonkey\n\t\t\t\t\tfor your changes to take effect, instead of having to re-pack and\n\t\t\t\t\tre-install your addon. Watches & compiles any TS files as they change.\n'
                + '\n'
                + chalk.cyan('\t--init') + '\t\t\t\tTool that automatically creates a new info.json file in the current\n\t\t\t\t\tfolder, after prompting for title, ID, version, etc. Similar to `npm init`.\n\t\t\t\t\tAlso, optionally initializes TypeScript support for code hints.'
                + '\nTYPESCRIPT INFORMATION:\n'
                + '\tpack-mmip enables you to write addons in TypeScript by integrating with the ' + chalk.blue('mediamonkey') + ' NPM package,\n\twhich contains type declarations for MediaMonkey\'s source code. During the build step, pack-mmip\n\ttransforms imports into the format that MediaMonkey expects, with correct relative paths, e.g. \n\t' + chalk.blue('import Multiview from "mediamonkey/controls/multiview"') + ' -> ' + chalk.blue('import Multiview from "./controls/multiview"'));
    // + '\t--init \t--init-project'.brightCyan+'\t\tSimilar to '+'npm init'.brightYellow+', this tool helps initialize an addon project\n\t\t\t\t\tby creating info.json and prompting for each item.'
    //+ '\nNOTE: The packed extension will be placed in the directory that this script was called from.';
    console.log(helpStr);
}
async function getFileListWithIgnore(pathToArchive, resultFilePath) {
    let ignoreString;
    let ignoreGlobs = ['*.zip', '*.mmip']; // Default ignoreGlobs
    // Search for an ignore file
    for (let ignoreFileName of ['.mmipignore', '.archiveignore']) {
        let ignoreFile = path.join(pathToArchive, ignoreFileName);
        if (fs.existsSync(ignoreFile)) {
            console.log(`Found ignore pattern in ${ignoreFileName}`);
            ignoreString = fs.readFileSync(ignoreFile, 'utf-8');
            ignoreString = ignoreString.replace(/\r/g, ''); // remove carriage return
            ignoreGlobs = ignoreString.split('\n');
            ignoreGlobs.push(ignoreFileName);
            ignoreGlobs.push(path.basename(resultFilePath)); // Add result filename to the ignore list, to avoid recursive issues, so I can turn off that warning
            break;
        }
    }
    console.log(chalk.yellow(`Ignoring the following file(s): ${(ignoreGlobs.join(', '))}`));
    var filteredMatches = [];
    // for some reason, glob doesn't like it when using Windows separator
    const matches = await glob.glob(path.join(pathToArchive, '**').split(path.sep).join(path.posix.sep));
    var minimatchOpts = {
        matchBase: true,
    };
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
            if (relativePath)
                filteredMatches.push(match); // to remove the "base folder" match
        }
        else
            debugLog(`Skipping ${match}`);
    }
    console.log(`${chalk.yellow(String(matches.length - filteredMatches.length - 1))} files skipped.\n`);
    return filteredMatches;
}
// Adjust imports/exports 
function processJSFile(contents, relativePath) {
    let numDirectoriesDeep = getDepth(relativePath) - 1; // since relativePath includes filename, subtract one
    let relative = getUpperRelativePath(numDirectoriesDeep);
    contents = contents
        // Replace imports from the type declarations package with the correct relative path, according to the file's relative position from the project root
        .replace(/(from|import) (["'])mediamonkey\//gm, (text) => {
        return text.replace('mediamonkey/', relative);
    })
        .replace(/^export \{\};?$/gm, '');
    // If this is an _add script, remove imports to itself (e.g. import PlaylistHeader, inside playlistHeader_add.ts)
    let filename = path.parse(relativePath).name;
    if (filename.endsWith('_add')) {
        let sourceCodeFilename = filename.split('_add')[0];
        let regex = new RegExp(`^import .*${sourceCodeFilename}["'];?$`, 'gm');
        debugLog(`Detected _add script: ${chalk.yellow(sourceCodeFilename)}. Regex to remove = ${chalk.blue(regex)}`);
        contents = contents.replace(regex, '');
    }
    // Remove empty export
    return contents;
}
// To convert 'declarations/etc' into the correct relative path from the addon's root
function getUpperRelativePath(depth) {
    if (depth == 0)
        return './';
    let ret = '';
    for (let i = 0; i < depth; i++) {
        ret += '../';
    }
    ;
    return ret;
}
function getDepth(relativePath) {
    // If the path is empty, depth is 0
    if (!relativePath)
        return 0;
    // Normalize the path and split by the platform-specific separator
    const parts = relativePath.split(path.sep);
    // Filter out empty parts (to handle edge cases) and return the count
    return parts.filter(part => part.length > 0).length;
}
async function getTargetAndSymlinkFromUser() {
    let target = positionals[0] || process.cwd();
    let pathToTarget = path.resolve(target);
    if (!fs.existsSync(pathToTarget)) {
        console.log(`Sorry, the provided path (${chalk.yellow(pathToTarget)}) does not exist.`);
        process.exit(1);
    }
    // Attempt to read addon ID
    let infoJsonPath = path.join(pathToTarget, 'info.json');
    let infoJson;
    let isSkin = false;
    try {
        infoJson = requireJSON(infoJsonPath);
        if (!infoJson.id) {
            console.log(`Invalid info.json! Could not find addon ID.`);
            process.exit(1);
        }
        if (infoJson.type === 'skin') {
            debugLog('Detected that this addon is a skin! Will attempt to put in Skins folder instead of Scripts.');
            isSkin = true;
        }
    }
    catch (err) {
        console.log(`Could not read ${chalk.yellow(infoJsonPath)}!`);
        process.exit(1);
    }
    let subFolder = isSkin ? 'Skins' : 'Scripts'; // change which folder to put in, depending on whether it's a skin or script
    // === END TARGET ===
    let appdataPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'MediaMonkey5', subFolder) : undefined;
    let programFilesPath1 = `C:\\Program Files (x86)\\MediaMonkey 5\\${subFolder}`;
    let programFilesPath2 = `C:\\Program Files (x86)\\Ventis\\MediaMonkey\\${subFolder}`;
    let defaultDestPath;
    // default to appdata folder
    if (appdataPath && fs.existsSync(appdataPath)) {
        defaultDestPath = appdataPath;
    }
    else if (fs.existsSync(programFilesPath1)) {
        defaultDestPath = programFilesPath1;
    }
    else if (fs.existsSync(programFilesPath2)) {
        defaultDestPath = programFilesPath2;
    }
    else {
        console.error(`Could not find MediaMonkey data folder or install location! Tried ${appdataPath}, ${programFilesPath1}, and ${programFilesPath2}`);
        process.exit(1);
    }
    // Default path: appdata/MM5 or MM5 install folder
    let destPath;
    if (opts['data-folder']) {
        destPath = opts['data-folder'];
    }
    else if (opts.yes) {
        destPath = defaultDestPath;
    }
    else {
        let answer = await rl.question(`Please enter the path to your MediaMonkey data folder (leave blank to default to ${defaultDestPath}): `);
        if (!answer || answer.trim() == '') {
            destPath = defaultDestPath;
        }
        else {
            destPath = answer;
        }
    }
    let symlinkBase = path.resolve(destPath);
    debugLog(path.join(symlinkBase, 'Portable', subFolder));
    // Check for 'Portable' subfolder
    if (fs.existsSync(path.join(symlinkBase, 'Portable', subFolder))) {
        debugLog(`Switching to Portable/${subFolder} folder`);
        symlinkBase = path.join(symlinkBase, 'Portable', subFolder);
    }
    if (path.basename(symlinkBase).toLowerCase() != subFolder.toLowerCase()) {
        symlinkBase = path.join(symlinkBase, subFolder);
        // Special-case 'sorry' message
        if (!fs.existsSync(symlinkBase)) {
            console.log(`Could not find a ${subFolder} folder (${chalk.yellow(symlinkBase)}). Did you enter the right path?`);
            process.exit(1);
        }
    }
    if (!fs.existsSync(symlinkBase)) {
        console.log(`Sorry, the provided path (${chalk.yellow(symlinkBase)}) does not exist.`);
        process.exit();
    }
    // Process the destination
    // let basename = path.basename(pathToTarget);
    let basename = infoJson.id; // addon ID
    let symlinkPath = path.join(symlinkBase, basename);
    return { symlinkPath, symlinkBase, infoJson, pathToTarget };
}
export function RunHostTask() {
    return new Promise(async (resolve, reject) => {
        const tempDir = process.env.TEMP;
        assert(tempDir, 'Could not find temp folder! Make sure TEMP environment variable is set.');
        const packMMIPHostFolder = path.join(tempDir, 'pack-mmip');
        const { symlinkBase, infoJson, pathToTarget: projectFolder } = await getTargetAndSymlinkFromUser();
        // Check if the requested addon is already installed
        debugLog('Checking if the requested addon is already installed separately...');
        const items = fs.readdirSync(symlinkBase);
        for (let item of items) {
            if (item === 'pack-mmip-hosted')
                continue; // skip the pack-mmip symlink
            let folderpath = path.join(symlinkBase, item);
            try {
                let stat = fs.statSync(folderpath);
                if (stat.isDirectory()) {
                    let infoJSONPath = path.join(folderpath, 'info.json');
                    let thisInfoJson = requireJSON(infoJSONPath);
                    if (thisInfoJson.id === infoJson.id) {
                        // Attempt to open folder in file explorer before throwing error
                        let p2 = spawn('explorer', [symlinkBase]);
                        await new Promise((resolve, reject) => {
                            p2.on('spawn', () => {
                                console.log("is spawned!");
                                setTimeout(resolve, 500); // doesn't seem to spawn if i don't set a timeout
                            });
                            p2.on('error', (error) => {
                                p2.kill();
                                reject(error);
                            });
                        });
                        assert(false, `Addon ${infoJson.id} is already installed normally! Please uninstall it first to avoid conflicts.`);
                    }
                }
            }
            catch (err) {
                console.error(err);
            }
        }
        const basename = infoJson.id;
        assert(basename, 'basename not defined');
        const destHostFolder = path.join(packMMIPHostFolder, basename); // folder containing compiled code
        const symlinkPath = path.join(symlinkBase, 'pack-mmip-hosted'); // only one pack-mmip-hosted addon at a time
        if (fs.existsSync(symlinkPath)) {
            assert(fs.lstatSync(symlinkPath).isSymbolicLink(), `Symlink destination path ${symlinkPath} exists, but is not a symlink. Abandoning to avoid accidental deletion of data.`);
            debugLog(`Unlinking ${symlinkPath}`);
            fs.unlinkSync(symlinkPath);
        }
        fs.rmSync(destHostFolder, { recursive: true, force: true });
        fs.mkdirSync(destHostFolder, { recursive: true });
        debugLog(`Linking ${symlinkPath} to ${destHostFolder}`);
        fs.symlinkSync(destHostFolder, symlinkPath, 'junction');
        const tsConfigPath = path.join(projectFolder, 'tsconfig.json');
        const isTSProject = fs.existsSync(tsConfigPath);
        let watchProgram;
        let program;
        // let program: ts.Program | undefined;
        // let parsedCommandLine: ts.ParsedCommandLine | undefined;
        // let incrementalProgram: ts.BuilderProgram | undefined;
        // if (isTSProject) {
        // 	const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
        // 	parsedCommandLine = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectFolder);
        // 	const host = ts.createIncrementalCompilerHost({
        // 		incremental: true,
        // 		...parsedCommandLine.options,
        // 	}, ts.sys);
        // 	const rootNames = parsedCommandLine.fileNames;
        // 	// program = ts.createProgram(parsedCommandLine.fileNames, parsedCommandLine.options);
        // 	incrementalProgram = ts.createIncrementalProgram({
        // 		rootNames: parsedCommandLine.fileNames,
        // 		options: {
        // 			...parsedCommandLine.options,
        // 			incremental: true,
        // 		},
        // 		host
        // 	});
        // }
        const doCopyFile = (file) => !file.includes('node_modules') &&
            !(program && program.getSourceFile(file));
        async function processFile(fromPath, toPath) {
            if (!doCopyFile(fromPath))
                return;
            fs.mkdirSync(path.dirname(toPath), { recursive: true }); // for new folders
            fs.copyFileSync(fromPath, toPath);
            // let fileName = path.basename(fromPath); // for logging
            // if (incrementalProgram && incrementalProgram.getSourceFile(fromPath)) {
            // 	debugLog(`File ${fileName} is part of the TS project`);
            // 	const jsFilePath = toPath.replace(/\.ts$/, '.js');
            // 	const relativePath = path.relative(projectFolder, fromPath);
            // 	let jsCode: string;
            // 	// JS files: skip compilation and just read code
            // 	if (fileName.toLowerCase().endsWith('.js')) {
            // 		jsCode = fs.readFileSync(fromPath, 'utf8');
            // 	}
            // 	// TS files: actually compile
            // 	else {
            // 		jsCode = await compileFile(incrementalProgram, fromPath);
            // 	}
            // 	let processedJSCode = processJSFile(jsCode, relativePath);
            // 	debugLog(`Writing file directly after processing: ${jsFilePath}`)
            // 	fs.writeFileSync(jsFilePath, processedJSCode, 'utf8');
            // }
            // else {
            // 	debugLog(`Copying file ${fileName} normally`);
            // 	fs.copyFileSync(fromPath, toPath);
            // }
        }
        async function copyFolder(from, to) {
            fs.mkdirSync(to, { recursive: true });
            const files = fs.readdirSync(from);
            for (let file of files) {
                if (!doCopyFile(file))
                    return;
                const fromPath = path.join(from, file);
                const toPath = path.join(to, file);
                if (fs.lstatSync(fromPath).isDirectory()) {
                    copyFolder(fromPath, toPath);
                }
                else {
                    processFile(fromPath, toPath);
                }
            }
        }
        copyFolder(projectFolder, destHostFolder);
        const fileWatcher = chokidar.watch(projectFolder, { depth: 10 });
        fileWatcher.on('change', (fileChanged) => {
            const relativePath = path.relative(projectFolder, fileChanged);
            // console.log(program?.getSourceFile(fileChanged));
            if (!doCopyFile(relativePath)) {
                return debugLog(`fileWatcher detected ${relativePath} changed but it's a TS/do-not-copy file, so skipping and letting tsc-watch handle it`);
            }
            const destPath = path.join(destHostFolder, relativePath);
            // if (program) {
            // 	let st = performance.now();
            // 	const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
            // 	parsedCommandLine = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectFolder);
            // 	console.log(performance.now() - st);
            // 	let dt = performance.now();
            // 	program = ts.createProgram(parsedCommandLine.fileNames, parsedCommandLine.options, undefined, program);
            // 	console.log(performance.now() - dt);
            // }
            processFile(fileChanged, destPath);
            // if (parsedCommandLine?.fileNames.includes(fileChanged)) {
            // 	console.log('file is in the ts program!');
            // }
            // // Copy this path to the correct location in destHostFolder
            // debugLog(`Copying ${relativePath}`)
            // fs.copyFileSync(fileChanged, destPath);
        });
        if (isTSProject) {
            debugLog('Creating TS watch program');
            const formatHost = {
                getCanonicalFileName: (path) => path,
                getCurrentDirectory: ts.sys.getCurrentDirectory,
                getNewLine: () => ts.sys.newLine
            };
            const createProgram = ts.createEmitAndSemanticDiagnosticsBuilderProgram;
            const host = ts.createWatchCompilerHost(tsConfigPath, {
                outDir: destHostFolder
            }, ts.sys, createProgram, reportDiagnostic, reportWatchStatusChanged);
            // You can technically override any given hook on the host, though you probably
            // don't need to.
            // Note that we're assuming `origCreateProgram` and `origPostProgramCreate`
            // doesn't use `this` at all.
            const origCreateProgram = host.createProgram;
            host.createProgram = (rootNames, options, host, oldProgram) => {
                const newProgram = origCreateProgram(rootNames, options, host, oldProgram);
                const origEmit = newProgram.emit;
                newProgram.emit = (targetSourceFile, writeFile, cancellationToken, emitOnlyDtsFiles, customTransformers) => {
                    const customWriteFile = (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
                        if (fileName.endsWith('.js')) {
                            debugLog(`Post-processing ${fileName}`);
                            const relativePath = path.relative(destHostFolder, fileName);
                            data = processJSFile(data, relativePath);
                        }
                        ts.sys.writeFile(fileName, data, writeByteOrderMark);
                    };
                    return origEmit(targetSourceFile, customWriteFile, cancellationToken, emitOnlyDtsFiles, customTransformers);
                };
                program = newProgram; // for quick getSourceFile()
                return newProgram;
            };
            watchProgram = ts.createWatchProgram(host);
            program = watchProgram.getProgram();
            function reportDiagnostic(diagnostic) {
                let formattedDiag = ts.formatDiagnosticsWithColorAndContext([diagnostic], {
                    getCurrentDirectory: () => projectFolder,
                    getCanonicalFileName: fileName => fileName,
                    getNewLine: () => formatHost.getNewLine()
                });
                console.error(`${formattedDiag}`);
            }
        }
        // Listen for if the user types 'q' into the console (without pressing enter)
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', function (key) {
            if (String(key) === 'q') {
                stop();
            }
        });
        console.log('Press ' + chalk.yellow('"q"') + ' to exit');
        process.on('SIGINT', stop);
        function stop() {
            console.log('Unmounting addon from MediaMonkey data folder...');
            fs.unlinkSync(symlinkPath);
            console.log('Done. Exiting');
            rl.close();
            resolve(undefined);
        }
        /**
         * Prints a diagnostic every time the watch status changes.
         * This is mainly for messages like "Starting compilation" or "Compilation completed".
         */
        function reportWatchStatusChanged(diagnostic) {
            console.log(`${diagnostic.messageText}`);
        }
    });
}
async function runCreateSymlink() {
    console.log(`${chalk.red('Deprecation notice:')} ${chalk.yellow('--create-symlink')} is being deprecated in favor of ${chalk.yellow('--dev')}.`);
    const { symlinkPath, pathToTarget } = await getTargetAndSymlinkFromUser();
    if (await questionAllowingAutoYes(`Create junction at ${chalk.yellow(symlinkPath)} -> ${chalk.yellow(pathToTarget)}? (yes): `)) {
        try {
            fs.symlinkSync(pathToTarget, symlinkPath, 'junction');
            if (opts.yes)
                console.log(`Created junction at ${chalk.yellow(symlinkPath)} -> ${chalk.yellow(pathToTarget)}.`); // extra information that was provided in the question
            else
                console.log(`Created junction.`);
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
async function runInitProjectTask() {
    console.log('This utility will walk you through initializing your project.');
    console.log('\nSee `pack-mmip --help` for info on how to use the rest of the tool\'s utilities.');
    console.log('\nPress ^C at any time to quit.\n');
    let autoName = path.basename(process.cwd());
    let title, id, description, type, version, author, minAppVersion, iconFile;
    let doTypeScript = await questionAllowingAutoYes('Include TypeScript support for type hinting in your IDE? (yes): ');
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
    if (iconFile)
        newInfoJson.icon = iconFile;
    let destination = path.join(process.cwd(), 'info.json');
    let output = JSON.stringify(newInfoJson, null, 4);
    let ok = await questionAllowingAutoYes(chalk.yellow(output) + '\n\nIs this OK? (yes): ');
    if (ok) {
        // write file
        try {
            fs.writeFileSync(destination, output, 'utf-8');
            if (opts.yes) {
                console.log(`Wrote to ${destination}:\n\n${output}`);
            }
            else {
                console.log(`Wrote to ${destination}.`);
            }
        }
        catch (err) {
            console.error(err);
            return rl.close();
        }
    }
    if (doTypeScript) {
        const tsconfigTemplate = fs.readFileSync(path.join(__dirname, 'tsconfig-template.jsonc'));
        let tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
        debugLog(`Outputting tsconfigTemplate to ${tsconfigPath}`);
        fs.writeFileSync(tsconfigPath, tsconfigTemplate, 'utf-8');
    }
}
function assert(condition, message) {
    if (!condition) {
        console.error(message);
        process.exit(1);
    }
}
