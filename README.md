# vscode content converter extension

## Demo

Given this configuration [`.vscode/settings.json`](./src/test/demo-workspace/.vscode/settings.json) as below:

```json
{
  "hi-ogawa.content-converter": {
    "converters": [
      {
        "name": "json prettify",
        "command": "jq -M"
      },
      {
        "name": "gzip decompress",
        "command": "gunzip -c -"
      }
    ]
  }
}
```

here is a demo screencast:

![demo.gif](./misc/demo.gif)

## Development

```sh
npm install
npm run build -- -w
npm run prettier
npm run test
cp -r .vscode-example/. .vscode  # then hit F5 to open src/test/demo-workspace
```
