## pack-mmip

Automatic packer for MediaMonkey Extension (MMIP) files. Requires Node.js and NPM.

### Installation
1. Run `npm install --global pack-mmip`.
1. Then, you can run `pack-mmip` and `pack-zip`.
1. If the commands do not work, make sure your NPM folder is added to your system PATH. (On Windows, it should be under `%appdata%/npm`.)

### Usage
```
pack-mmip (path to directory) (path to packed extension OR just its name) (options)

OPTIONS:
        -a      --AppendVersion         Read the project's version from its info.json and append it to the
                                        filename. For example: MyAddon-1.2.3.mmip
        -b      --PutFileIntoBin        Put resulting file into a subfolder named "bin"
        -d      --Debug                 Debug logs. Please use this if you encounter a bug, and paste the
                                        logs into a new GitHub issue.
        -h      --help                  Print this help text and exit
        -i      --IgnoreDefaults        Ignore configuration rules
        -o      --OpenAfterComplete     Open file (Install to MediaMonkey) after complete
        -s      --ShowAfterComplete     Show in folder after complete
        -v      --version               Print version and exit
        -y      --Yes                   Automatically answer "yes" to prompts

        -p      --PreambleFile <name>   File containing a preamble to be added to the top of text files.

TO IGNORE CERTAIN FILES:
                                        Add a file named .mmipignore or .archiveignore in your project root.
                                        It uses glob syntax similar to .gitignore
                                        (see https://www.npmjs.com/package/glob)
TO CONFIGURE DEFAULT BEHAVIOR:
        pack-mmip config                Different configuration files are saved for pack-mmip and pack-zip.

If path to packed extension is not specified, it will default to the name of the folder.
Additionally comes with a command pack-zip if you wish to use it to output a ZIP file instead of MMIP.

ADDITIONAL UTILITIES:
        --dev <path>                    Tool that temporarily "mounts" your addon to MediaMonkey's scripts/
         [--data-folder <path>]         skins folder, making development easier. Just restart MediaMonkey
                                        for your changes to take effect, instead of having to re-pack and
                                        re-install your addon. Watches & compiles any TS files as they change.

        --init                          Tool that automatically creates a new info.json file in the current
                                        folder, after prompting for title, ID, version, etc. Similar to `npm init`.
                                        Also, optionally initializes TypeScript support for code hints.
TYPESCRIPT INFORMATION:
        pack-mmip enables you to write addons in TypeScript by integrating with the mediamonkey NPM package,
        which contains type declarations for MediaMonkey's source code. During the build step, pack-mmip
        transforms imports into the format that MediaMonkey expects, with correct relative paths, e.g.
        import Multiview from "mediamonkey/controls/multiview" -> import Multiview from "./controls/multiview"
```

Examples:
```sh
# Packs C:/projects/MyPackage into C:/projects/MyPackage.mmip
pack-mmip C:/projects/MyPackage

# Does the same as above, but with relative paths instead of absolute paths
cd C:/projects/MyPackage
pack-mmip .
# If you do not provide a file name, the output file name will be based on the folder name. You can provide the output file name as a second argument.
pack-mmip . MyPackageName
pack-mmip . MyPackageName.mmip

# The -s argument will open a file explorer window containing the newly packed file.
pack-mmip ./ ../MyPackage -s

# The -o argument will attempt to run the file, causing MediaMonkey to install it.
pack-mmip ./ ../MyPackage -o
```

### TypeScript information
pack-mmip enables you to write addons in TypeScript by integrating with the `mediamonkey` NPM package, which contains type declarations for MediaMonkey's source code. During the build step, pack-mmip transforms imports into the format that MediaMonkey expects, with correct relative paths, e.g. 
`import Multiview from "mediamonkey/controls/multiview"` -> `import Multiview from "./controls/multiview"`

Running `pack-mmip --init` will prompt you to set up TypeScript support. Doing so is highly recommended. You do **not** need to write your addon's code in TypeScript. The default `tsconfig.json` that is created will enable type hinting for JS files as well.

If type hinting does not show up, or you see an error saying that the package "mediamonkey" could not be found, you may have to run `npm install --save-dev mediamonkey` in your project.
<!-- ### Installation from source
1. Download as a zip, and extract it to the folder of your choice
1. Run `npm install`
1. Add the folder to your system PATH
1. Then, you can run `pack-mmip`. -->