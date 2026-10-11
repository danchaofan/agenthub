# Third-party references

Agenthub's product source is released under [MIT](LICENSE). npm dependencies retain their own licenses; the resolved versions and package metadata are recorded in `package-lock.json`.

The following projects inspired the runtime bridge and resource-discovery design:

| Project                                       | Reference snapshot                         | License | Use                                                        |
| --------------------------------------------- | ------------------------------------------ | ------- | ---------------------------------------------------------- |
| [botmux](https://github.com/deepcoldy/botmux) | `ff803e6bc3c81fe700799cdf8cf2d1819965016b` | MIT     | CLI bridging, execution visibility and permission behavior |
| [Orca](https://github.com/stablyai/orca)      | `2eb6a920ddfeff5e5f2b9144e0ab0c0f13c74319` | MIT     | Local discovery, dynamic model catalogs and quota queries  |

Their research archives are kept locally in ignored directories. They are not shipped with Agenthub and are not runtime dependencies. Research documents link to the pinned upstream sources rather than local filesystem paths.

Agenthub invokes an independently installed [Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) through ACP. Kimi Code is not bundled; its license, account terms, authentication and model charges remain its own.
