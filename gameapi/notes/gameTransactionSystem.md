# gameTransactionSystem

`TransactionSystem` in scripts: items in inventories, including money. Get it with `GameInstance.GetTransactionSystem(gameInstance)`. Money is an item: `MarketSystem.Money()` returns its `ItemID`.

Tested in game on 2.31 (2026-10-12): [O6b test](https://edgemodders.github.io/REDnode/overlay.html#o6b-game-api-test).

## GetItemQuantity

How many of an item an object has. With V and the money item, V's eddies, as the inventory shows.

```js
const shop = await api.GameInstance.GetTransactionSystem(game.instance);
const eddies = await shop.GetItemQuantity(player, await api.MarketSystem.Money());
```

## GiveItem

Adds items to an object's inventory and returns true when it did. `dynamicTags` is optional. Giving V 100 of the money item adds 100 eddies at once.

```js
await shop.GiveItem(player, await api.MarketSystem.Money(), 100);
```
