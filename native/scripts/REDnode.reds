// REDnode P1 probe.
// Exercises both tiers once when the player is attached to the world.
// Remove red4ext/plugins/REDnode from the game folder to disable it.

public static native func REDnode_Ping(value: Int32) -> Int32
public static native func REDnode_Emit(name: String, value: Int32) -> Void

@wrapMethod(PlayerPuppet)
protected cb func OnGameAttached() -> Bool {
  let result: Bool = wrappedMethod();

  // Tier 1 path: synchronous native call. The script uses the return value.
  let pong: Int32 = REDnode_Ping(21);

  // Tier 2 path: queued, then logged on the game thread by the pump.
  REDnode_Emit("PlayerPuppet.OnGameAttached REDnode_Ping(21)", pong);

  return result;
}
