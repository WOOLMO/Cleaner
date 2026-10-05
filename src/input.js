import readline from "node:readline";

// Prompts for a real terminal (single keypress for y/N) that also work when answers are piped in.
const TTY_IN = Boolean(process.stdin.isTTY);

let pipe = null;

function pipeReader() {
  if (pipe) return pipe;
  pipe = { lines: [], waiting: [], ended: false };
  let buffer = "";
  const deliver = (line) => {
    const clean = line.replace(/^﻿/, "").replace(/\r$/, ""); // PowerShell pipes start with a byte-order mark
    const resolve = pipe.waiting.shift();
    if (resolve) resolve(clean);
    else pipe.lines.push(clean);
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      deliver(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
    }
  });
  process.stdin.on("end", () => {
    if (buffer) deliver(buffer);
    buffer = "";
    pipe.ended = true;
    while (pipe.waiting.length) pipe.waiting.shift()(null);
  });
  return pipe;
}

function nextPipedLine() {
  const p = pipeReader();
  if (p.lines.length) return Promise.resolve(p.lines.shift());
  if (p.ended) return Promise.resolve(null);
  return new Promise((resolve) => p.waiting.push(resolve));
}

export async function askLine(prompt) {
  if (!TTY_IN) {
    process.stdout.write(prompt);
    const line = (await nextPipedLine()) ?? "";
    process.stdout.write(line + "\n");
    return line.trim();
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.on("SIGINT", () => {
    rl.close();
    process.stdout.write("\n");
    process.exit(130);
  });
  const answer = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  return answer.trim();
}

// Classic y/N: one keypress in a terminal, Enter takes the default.
export async function askKey(prompt, { defaultYes = false } = {}) {
  if (!TTY_IN) {
    const line = await askLine(prompt);
    return line === "" ? defaultYes : /^y(es)?$/i.test(line);
  }
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const { stdin } = process;
    const finish = (answer) => {
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write((answer ? "y" : "n") + "\n");
      resolve(answer);
    };
    const onKey = (key) => {
      if (key === "\u0003") {
        stdin.setRawMode(false);
        process.stdout.write("^C\n");
        process.exit(130);
      }
      const k = key.toLowerCase();
      if (k === "y") finish(true);
      else if (k === "n" || k === "\u001b") finish(false);
      else if (k === "\r" || k === "\n") finish(defaultYes);
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onKey);
  });
}

export function closeInput() {
  if (pipe) {
    process.stdin.removeAllListeners("data");
    process.stdin.pause();
  }
}
