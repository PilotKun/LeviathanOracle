## Command Module Structure

### Shared Export Properties (Slash & Prefix)

| Property         | Type                    | Required   | Description                                                                 |
|------------------|-------------------------|------------|-----------------------------------------------------------------------------|
| `disabled`       | boolean                 | Optional   | Set to `true` to disable the command (prevents registration/execution).     |
| `botPermissions` | array of strings        | Optional   | Permissions the bot must have to execute the command.                       |
| `userPermissions`| array of strings        | Optional   | Permissions the user must have to use the command.                          |
| `adminOnly`      | boolean                 | Optional   | If `true`, only bot admins can use this command.                            |
| `ownerOnly`      | boolean                 | Optional   | If `true`, only the bot owner can use this command.                         |
| `devOnly`        | boolean                 | Optional   | If `true`, only developers (as defined in config) can use this command.     |
| `cooldown`       | number (seconds)        | Optional   | Cooldown period to prevent spam.                                            |
| `requiredRoles`  | array of role IDs       | Optional   | Only users with these role IDs can run this command.                        |

---

### Slash Commands (for `/` commands)

- Place in `src/commands/<Category>/<command>.js`
- Must export an object with:
  - `data`: a `SlashCommandBuilder` instance (from discord.js) defining the command (required)
  - `execute(interaction)`: async function for command logic (required)
  - Any shared properties from the table above (optional)
  - `autocomplete`: async function for option autocomplete (optional)

**Example:**
```js
const { SlashCommandBuilder } = require('discord.js');
module.exports = {
    // Optional: Set to true to disable the command
    disabled: false,

    // Required: Defines the slash command's structure
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('This is the ping command.'),

    // Required: Main logic for the command
    async execute(interaction) {
        // ...command logic...
    },

    // Optional: Permissions and restrictions (see shared table above)
    // botPermissions: ['SendMessages'],
    // userPermissions: ['ManageMessages'],
    // adminOnly: true,
    // ownerOnly: true,
    // devOnly: true,
    // cooldown: 10,
    // requiredRoles: ['roleId1', 'roleId2'],

    // Optional: Autocomplete handler
    // async autocomplete(interaction) { ... }
};
```

### Prefix Commands (for `!` or custom prefix)

- Place in `src/messages/<Category>/<command>.js`
- Must export an object with:
  - `name`: the command name (string, required)
  - `description`: short help text (required)
  - `execute(message)`: async function for command logic (required)
  - `aliases`: array of alternative names (optional)
  - Any shared properties from the table above (optional)

**Example:**
```js
module.exports = {
    // Optional: Set to true to disable the command
    disabled: false,

    // Required: Command name
    name: 'ping',

    // Required: Description
    description: 'This is the ping command.',

    // Optional: Aliases
    aliases: ['p'],

    // Required: Main logic for the command
    async execute(message) {
        // ...command logic...
    },

    // Optional: Permissions and restrictions (see shared table above)
    // botPermissions: ['SendMessages'],
    // userPermissions: ['ManageMessages'],
    // adminOnly: true,
    // ownerOnly: true,
    // devOnly: true,
    // cooldown: 10,
    // requiredRoles: ['roleId1', 'roleId2'],
};
```

**Note:**
- Prefix command files may require their slash command counterpart for shared logic, but should not duplicate code unnecessarily.
- Always keep command files minimal and only export what is needed for the command system to function.

---
