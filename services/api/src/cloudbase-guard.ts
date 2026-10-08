export function notWired(entrypoint: string): never {
  throw new Error(`${entrypoint} is not connected to CloudBase business APIs. Use the isolated mock or MW04 validation functions.`);
}
