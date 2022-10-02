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
        --preamble-<filetype> <pattern> Pattern for the preamble to be inserted into files of the specified
                                        extension, most notably because different types of code have different
                                        patterns for comments. Use %s for where the preamble text should go.
                                        For example: --preamble-js "/* %s */" --preamble-html "<!-- %s -->"
TO IGNORE CERTAIN FILES:
                                        Add a file named .mmipignore or .archiveignore in your project root.
                                        It uses glob syntax similar to .gitignore
                                        (see https://www.npmjs.com/package/glob)
TO CONFIGURE DEFAULT BEHAVIOR:
        pack-mmip config                Different configuration files are saved for pack-mmip and pack-zip.

If path to packed extension is not specified, it will default to the name of the folder.
Additionally comes with a command pack-zip if you wish to use it to output a ZIP file instead of MMIP.

ADDITIONAL UTILITIES:
        --create-symlink <path>         Tool that creates a symbolic link from your install's scripts folder to
                                        your project folder, making it easier for development. Just restart
                                        MediaMonkey for your changes to take effect, instead of having to
                                        re-pack and re-install the addon.
        --init                          Tool that automatically creates a new info.json file in the current
                                        folder, after prompting for title, ID, version, etc. Similar to `npm init`.
```

Examples:
```sh
# Packs C:/projects/MyPackage into C:/projects/MyPackage.mmip
pack-mmip C:/projects/MyPackage C:/projects/MyPackage.mmip

# Does the same as above, but with relative paths instead of absolute paths
# If you do not add a .mmip file extension, it will do it for you.
cd C:/projects/MyPackage
pack-mmip ./ ../MyPackage

# The -s argument will open a file explorer window containing the newly packed file.
pack-mmip ./ ../MyPackage -s

# The -o argument will attempt to run the file, causing MediaMonkey to install it.
pack-mmip ./ ../MyPackage -o
```

### Installation from source
1. Download as a zip, and extract it to the folder of your choice
1. Run `npm install`
1. Add the folder to your system PATH
1. Then, you can run `pack-mmip`.