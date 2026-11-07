// Records each command it receives, so the e2e test can check it ran.
messenger.commands.onCommand.addListener(name => messenger.storage.local.set({ lastCommand: name }));
