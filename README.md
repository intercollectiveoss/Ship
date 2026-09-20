<h1 align="left" style="margin: 0 0 10px 0; font-size: 64px; font-weight: 900; letter-spacing: -0.08em; line-height: 0.9;">
  ship
</h1>
<p align="left" style="margin: 0 0 18px 0; font-size: 18px; color: #6b7280; line-height: 1.4;">
designed and built by onyxpowered. debugged with claude.
</p>

a self-hosted developer platform for shipping apps to your own machines, with throttling and monitoring built in. no third-party host is required in the loop.

## requirements

one, node. if you're a developer, you already have this.
two, a basic operating system. as long as it's not FreeBSD, you should be fine.

## install

```bash
git clone https://github.com/onyxpowered/Ship.git
cd ship
npm link
```

this (should) put a real `ship` command on your Terminal PATH.

### one, start the daemon.

start the local daemon once per machine. 

to run it in the foreground:

```bash
ship daemon start
```

or, if you want it to survive terminal closes and reboots:

```bash
ship daemon install
```

### two, create an account.

```bash
ship login --signup
```

### three, create or import an app.

if you want to start fresh:

```bash
ship new my-app
```

or import:

```bash
ship import /path/to/existing/app --name=my-app
```

if you imported an existing repo or app, add a `ship.config.js` file so ship can discover ports and runtime settings. the default shape looks like this:

```js
export default {
  blocks: {
    web: {
      command: 'npm start',
      expose: true,
      healthCheck: { port: 3000 },
    },
  },
};
```

that's temporary. we're working on a smarter framework detection system.

if you already have an app scaffolded, make sure `healthCheck.port` reflects the port your service actually listens on.

### four, deploy your app.

ship has two deployment modes.

for local development, deploy to your own machine:

```bash
ship deploy ./my-app
```

for production, deploy to your own domain:

```bash
ship deploy production ./my-app --domain=example.com
```

### five, keep an eye on it.

```bash
ship logs <app name>
ship daemon status
```

### six, tear it down, cleanly.

to stop hosting your app:

```bash
ship stop my-app
```

and to stop ship entirely:

```bash
ship daemon uninstall
```

### further reading.

thank you for trying ship. it's in early testing, and improvements are constantly being made. if you want a more open version with test files and notes, head to [the sdk.](https://github.com/onyxpowered/SDK)

if you have questions, comments, or, you guessed it, pull requests, hit up community@onyxpowered.com
