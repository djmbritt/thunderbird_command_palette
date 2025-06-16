# Thunderbird command palette

The missing command palette for Thunderbird.

## Research

Research notes on what to do next

### Accessing window API

At the following there is some information about how to use the `experiment_apis` to access the window object. Which will allow us to run the following function:

```js
window.openContentTab("about:config")
```

This will simplify the process of navigating to the different pages using our command palette.

#### Example

At the following link we can also see an example of how they access the `experiment_apis`:
<https://github.com/dillenger/phoenity-buttons/tree/main>

particularly, look at this:

```js
// import the following modules
var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
var { MailUtils } = ChromeUtils.importESModule("resource:///modules/MailUtils.sys.mjs");
var xulAppInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);

// ...

// Gives us access to the window object
configButton.addEventListener("command", () => window.openContentTab("about:config"));
```

Full snippet: <https://github.com/dillenger/phoenity-buttons/blob/main/implementation.js>

### Mozilla Module Docs

Here's some more docs: <https://firefox-source-docs.mozilla.org/jsloader/system-modules.html>

### Official Thunderbird extension docs

<https://webextension-api.thunderbird.net/en/latest/experiments/introduction.html>

### Thunderbird web extension examples

A good guide containing lot's of relevant examples and information.

<https://github.com/thunderbird/webext-examples>

