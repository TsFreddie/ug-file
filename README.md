# ug-file

Unofficial TypeScript SDK for UGOS Pro / UGREEN NAS file management APIs.

`ug-file` provides a small ESM client for authenticating with UGOS, resolving UGREENlink aliases, listing directories, reading and uploading files, and performing common file operations such as copy, move, rename, trash, and delete.

## Features

- Authenticate against UGOS Pro with RSA-encrypted credentials.
- Connect by direct UGOS URL or by UGREENlink ID.
- List root folders and directory contents with file/directory helpers.
- Read, download, and upload files.
- Create folders and manage files with copy, move, rename, trash, and permanent delete operations.
- Use native `fetch`, or inject a custom `fetch` implementation.
- Fully typed TypeScript API.

## Requirements

- Bun for local development. The package is configured with `bun@1.3.13`.
- A runtime with `fetch`, `FormData`, and `Blob` support. Node.js 18+ works out of the box.
- Network access to your UGOS Pro / UGREEN NAS instance.

## Installation

```sh
bun add ug-file
```

If installing from this repository during development:

```sh
bun install
bun run build
```

## Quick Start

```ts
import { UgosClient } from "ug-file";

const client = new UgosClient({
  url: "https://your-nas.example.com",
  username: "admin",
  password: "your-password"
});

await client.login();

const entries = await client.list("/Documents");
for (const entry of entries) {
  console.log(entry.name, entry.isDirectory() ? "directory" : "file");
}
```

## Connecting

### Direct URL

Use `url` when you already know the UGOS base URL.

```ts
const client = new UgosClient({
  url: "https://your-nas.example.com",
  username: "admin",
  password: "your-password"
});
```

### UGREENlink ID

Use `uglinkid` to resolve a UGREENlink alias automatically through the public UGREENlink API.

```ts
const client = new UgosClient({
  uglinkid: "your-alias",
  username: "admin",
  password: "your-password"
});
```

You can also resolve an alias directly:

```ts
const url = await UgosClient.resolveUgreenLinkUrl("your-alias");
```

### Custom Fetch

Pass `fetch` when your runtime does not provide `globalThis.fetch`, or when you need custom transport behavior.

```ts
const client = new UgosClient({
  url: "https://your-nas.example.com",
  username: "admin",
  password: "your-password",
  fetch: customFetch
});
```

## Usage

Call `login()` before using authenticated file APIs.

```ts
const session = await client.login();
console.log(session.uid);
```

### List Files

```ts
const entries = await client.list("/Documents", { page: 1, limit: 100 });

for (const entry of entries) {
  if (entry.isFile()) {
    console.log(entry.path, entry.size);
  }
}
```

### Root Folders

```ts
const { personal, shared } = await client.root();

console.log("Personal roots", personal.map((entry) => entry.name));
console.log("Shared roots", shared.map((entry) => entry.name));
```

### File Metadata and Existence

```ts
if (await client.exists("/Documents/report.pdf")) {
  const stat = await client.stat("/Documents/report.pdf");
  console.log(stat.name, stat.size, new Date(stat.mtime));
}
```

### Read and Download Files

```ts
const text = await client.readFile("/Documents/notes.txt", "utf8");
const bytes = await client.readFile("/Documents/archive.bin");

const response = await client.download("/Documents/report.pdf");
const arrayBuffer = await response.arrayBuffer();
```

### Upload Files

```ts
await client.upload("/Documents/hello.txt", "Hello from ug-file");

const bytes = new TextEncoder().encode("binary content");
await client.upload("/Documents/data.bin", bytes);
```

Upload content can be a `string`, `Blob`, `ArrayBuffer`, `ArrayBufferView`, or `ReadableStream<Uint8Array>`.

### Manage Files and Folders

```ts
await client.mkdir("/Documents/Projects", true);

await client.copy("/Documents/file.txt", "/Backup/", "skip");
await client.move(["/Downloads/a.txt", "/Downloads/b.txt"], "/Documents/", "overwrite");
await client.rename("/Documents/old-name.txt", "new-name.txt");

await client.trash("/Documents/old-file.txt");
await client.delete("/Documents/remove-forever.txt");
```

Conflict actions for `copy` and `move` are:

- `"skip"` or `1`: skip conflicting items.
- `"overwrite"` or `2`: replace conflicting items.
- `"keep-both"` or `3`: keep both files by allowing UGOS to rename the copied or moved entry.

## API Overview

Main exports:

- `UgosClient`
- `UgosApiError`
- `UgosHttpError`
- Type exports including `UgosClientConfig`, `UgosDirent`, `UgosFileEntry`, `UgosRoot`, `SessionContainer`, `LoginResponse`, and `ConflictAction`.

`UgosClient` methods:

- `UgosClient.resolveUgreenLinkUrl(ugreenLinkId, fetchImpl?)`
- `client.login()`
- `client.currentSession`
- `client.list(path?, options?)`
- `client.exists(path)`
- `client.root()`
- `client.stat(path)`
- `client.mkdir(path, recursive?)`
- `client.copy(src, dst, action?)`
- `client.move(src, dst, action?)`
- `client.rename(path, newName)`
- `client.download(path)`
- `client.readFile(path, encoding?)`
- `client.upload(path, content)`
- `client.trash(path)`
- `client.delete(path)`

## Error Handling

```ts
import { UgosApiError, UgosHttpError } from "ug-file";

try {
  await client.login();
  await client.list("/Documents");
} catch (error) {
  if (error instanceof UgosApiError) {
    console.error("UGOS API error", error.code, error.body);
  } else if (error instanceof UgosHttpError) {
    console.error("HTTP error", error.status, error.body);
  } else {
    throw error;
  }
}
```

## Development

```sh
bun install
bun run typecheck
bun run build
```

Available scripts:

- `bun run build`: generate declaration files and bundle the package into `dist`.
- `bun run build:types`: emit TypeScript declaration files only.
- `bun run build:bundle`: bundle `src/index.ts` into `dist`.
- `bun run typecheck`: run TypeScript without emitting files.

## Notes

- This is an unofficial SDK and is not affiliated with UGREEN or UGOS.
- File operations run against your NAS account and may modify or permanently delete remote files.
- `delete()` permanently removes files. Use `trash()` when you want UGOS recycle-bin recovery behavior.
