## pack-mmip

Automatic packer for MediaMonkey Extension (MMIP) files. Requires Node.js and NPM.

### Installation
1. Download as a zip, and extract it to the folder of your choice
1. Run `npm install`
1. Add the folder to your system PATH
1. Then, you can run `pack-mmip`.

### Usage
```
pack-mmip (path to directory) (path to packed extension OR just its name) (options)

OPTIONS:
        -y      --Yes                   Automatically answer "yes" to prompts
        -o      --OpenAfterComplete     Open file (Install to MediaMonkey) after complete
        -s      --ShowAfterComplete     Show in folder after complete
```

Examples:
```
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
