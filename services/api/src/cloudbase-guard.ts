export function notWired(entrypoint: string): never {
  throw new Error(`${entrypoint} is not connected to CloudBase in MW03. Use the isolated mock.`);
}
