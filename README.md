# 🔨 tsukuru

This package enables you to build a TypeScript package that's compatible with both CommonJS and ES Modules - **without writing any duplicate code!**

| Consumer environment           | compiled by `tsc`                                                                              | compiled by `tsukuru`             |
|--------------------------------|------------------------------------------------------------------------------------------------|-----------------------------------|
| node, CommonJS                 | ❌ `const foo = require('foo').default`                                                         | ✔ `const foo = require('foo');`   |
| node, native ES Modules (.mjs) | ❌ `import foo from 'foo'; foo.default();`<br>(incompatible with its own generated definitions) | ✔ `import foo from 'foo'; foo();` |
| typescript                     | ✔ `import foo from 'foo'; foo();`                                                              | ✔ `import foo from 'foo'; foo();` |

This is a heavy work in progress, **use at your own risk**!

## Installing

```sh
yarn add --dev tsukuru
# or
npm install --save-dev tsukuru
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
        "build": "tsukuru",
        "rebuild": "tsukuru --clean"
    }
}
```

Assuming that your `outDir` is `lib`. The output directory of the ES Modules is currently hardcoded to be `es`.

## CLI options

### -c, --config-file

Specifies the path to your TypeScript configuration file (`tsconfig.json`).
If none is given, `tsukuru` will traverse your project directory and its ancestors until it finds a file named `tsconfig.json`.

### -R, --no-cjs-root-export

Disables the use pf `require('pkg')` as a shortcut to the default export. Consumers must use `require('pkg').default` instead.
This may considerably decrease your package's total size.

### --clean

Removes the output directories before building.

## How does this work?

This package runs the TypeScript compiler twice internally.

The first build will create a CommonJS version.
It utilizes custom TypeScript transformers to augment and rearrange the `module.exports` statements
so that you can use `require('pkg')` instead of `require('pkg').default`
to access the default export of your package.

The second build will create a ES Module version.
It will overwrite some of your tsconfig.json configuration to ensure compatibility with ESM modules.
It also utilizes another custom transformer to resolve the import paths because node doesn't do that by default.
Lastly, it uses a hack to make TypeScript output .mjs files instead of .js.

## FAQ

### There's a problem using an import from `<other package>` in the ESM build when using node!

Sadly, the world of npm packages isn't quite ready yet for ESM. Please make sure that the package supports importing ESM before filing an issue here.

If it doesn't, maybe make a change by sending pull requests to your favorite libraries? ✨

### What does the name mean?

It's Japanese for the verb "build" or "construct". It's usually written like this: 作る
