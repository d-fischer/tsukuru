# TypeScript Hybrid ESM Build

This package enables you to build a TypeScript package that's compatible with both CommonJS and ES Modules. It achieves this by:

- Creating a normal build using your tsconfig.json
- Creating another build with a modified configuration, overwriting some settings from yours to ensure ESM compatibility
- Renaming all output files to .mjs and adjusting the imports accordingly with a TypeScript transformer

This is a heavy work in progress, **use at your own risk**!

## Installing

```sh
yarn add --dev ts-hybrid-esm-build
# or
npm install --save-dev ts-hybrid-esm-build
```

## Configuration of package.json

Put this (or something similar) in your package.json:

```json
{
    "main": "lib",
    "types": "lib",
    "module": "es",
    "exports": {
        ".": {
            "require": "./lib/index.js",
            "import": "./es/index.mjs"
        }
    },
    "scripts": {
        "build": "ts-hybrid-esm-build",
        "rebuild": "ts-hybrid-esm-build --clean"
    }
}
```

Assuming that your `outDir` is `lib`. The output directory of the ES Modules is currently hardcoded to be `es`.

## CLI options

### -c, --config-file

Specifies the path to your TypeScript configuration file (`tsconfig.json`). If none is given, `ts-hybrid-esm-build` will traverse the ancestors of your project directory until it finds a file named `tsconfig.json`.

### -R, --no-cjs-root-export

Disables the use pf `require('pkg')` as a shortcut to the default export. Consumers must use `require('pkg').default` instead.
This may considerably decrease you're package's total size.

### --clean

Removes the output directories before building.
