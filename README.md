# Niri-Window-Manager

This project is a window manager for Niri and is supposed to be ran on the host device (has Niri)

> You could say this is a translation layer between the Niri IPC calls to HTTP requests

## Usage

Run the project (make sure you are in the directory where all of the files exists

```bash
go run .
```

then just make a HTTP request,

```
# Example
curl -X POST http://localhost:8080/workspace/up
```

figure out on your own on how to make your connection exposed to the public so you can use it on a remote device

## Contributing

Pull requests are welcome. For major changes, please open an issue first
to discuss what you would like to change.

Please make sure to update tests as appropriate.
