#!/usr/bin/env node
import { basename, extname, resolve } from "node:path";
import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { renderHtmlDocument } from "./markdown.js";

interface CliOptions {
  input?: string;
  output?: string;
  watch: boolean;
  help: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.input) {
    printHelp();
    process.exit(1);
  }

  const inputPath = resolve(options.input);
  const outputPath = resolve(options.output ?? defaultOutputPath(options.input));

  await convert(inputPath, outputPath);

  if (options.watch) {
    console.log(`Watching ${inputPath}`);
    let timer: NodeJS.Timeout | undefined;

    watch(inputPath, { persistent: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        convert(inputPath, outputPath).catch((error: unknown) => {
          console.error(formatError(error));
        });
      }, 100);
    });
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    watch: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--watch") {
      options.watch = true;
      continue;
    }

    if (arg === "-o" || arg === "--output") {
      const output = args[index + 1];
      if (!output || output.startsWith("-")) {
        throw new Error("Missing output file after -o/--output.");
      }
      options.output = output;
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.input) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    options.input = arg;
  }

  return options;
}

async function convert(inputPath: string, outputPath: string): Promise<void> {
  const markdown = await readFile(inputPath, "utf8");
  const title = basename(inputPath, extname(inputPath));
  const html = renderHtmlDocument(markdown, { title });
  await writeFile(outputPath, html, "utf8");
  console.log(`Converted ${inputPath} -> ${outputPath}`);
}

function defaultOutputPath(input: string): string {
  const extension = extname(input);
  if (!extension) {
    return `${input}.html`;
  }
  return `${input.slice(0, -extension.length)}.html`;
}

function printHelp(): void {
  console.log(`Usage:
  md2html input.md -o output.html
  md2html input.md --watch

Options:
  -o, --output <file>  Write HTML to the given file
  --watch             Rebuild whenever the input file changes
  -h, --help          Show this help message`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exit(1);
});
