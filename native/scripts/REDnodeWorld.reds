// REDnode W1: placing entities from Node mods, through Codeware.
// Compiled only when Codeware is installed; without it, REDnode works as before and
// api.spawn and the entity events say they need Codeware.
//
// Node mods reach this through the rednode package's api:
//   REDnodeWorld.Spawn(spec, components)  spawns a dynamic entity and attaches the
//                                         components while it assembles
//   REDnodeWorld.Delete(entityID)         removes it
//   REDnodeWorld.Move(entityID, position, orientation)   places it
//   REDnodeWorld.Watch(entityID)          entity events for an entity spawned elsewhere
//   REDnodeWorld.Ready()                  true once the system runs, with Codeware
// The events Entity/Initialize, Entity/AfterAttach and Entity/Detach reach Node mods as
// game events, with the entity's ID and class, through REDnode_EntityEvent.

public static native func REDnode_EntityEvent(name: String, entityID: EntityID, entityType: CName) -> Void

@if(ModuleExists("Codeware"))
public class REDnodeWorld extends ScriptableSystem {
  // Components waiting for their entity: the spawn's own tag, and one component each.
  private let m_pendingTag: array<CName>;
  private let m_pendingComponent: array<ref<IComponent>>;
  private let m_spawns: Int32;
  private let m_initialize: ref<CallbackSystemHandler>;
  private let m_attach: ref<CallbackSystemHandler>;
  private let m_detach: ref<CallbackSystemHandler>;

  public func OnAttach() -> Void {
    // Only entities REDnode spawned (its tag) or was asked to watch (by ID).
    let callbacks = GameInstance.GetCallbackSystem();
    this.m_initialize = callbacks.RegisterCallback(n"Entity/Initialize", this, n"OnEntityInitialize")
      .AddTarget(DynamicEntityTarget.Tag(n"REDnode"));
    this.m_attach = callbacks.RegisterCallback(n"Entity/AfterAttach", this, n"OnEntityAttached")
      .AddTarget(DynamicEntityTarget.Tag(n"REDnode"));
    this.m_detach = callbacks.RegisterCallback(n"Entity/Detach", this, n"OnEntityDetach")
      .AddTarget(DynamicEntityTarget.Tag(n"REDnode"));
  }

  private static func Get() -> ref<REDnodeWorld> {
    return GameInstance.GetScriptableSystemsContainer(GetGameInstance()).Get(n"REDnodeWorld") as REDnodeWorld;
  }

  public static func Ready() -> Bool {
    return IsDefined(REDnodeWorld.Get());
  }

  // Spawns a dynamic entity from a spec built by the mod (a DynamicEntitySpec) and
  // attaches the components while it assembles. The spawn gets REDnode's tag and one
  // of its own, which keys its components, so they wait only for this entity.
  public static func Spawn(spec: ref<DynamicEntitySpec>, components: array<ref<IComponent>>) -> EntityID {
    let world = REDnodeWorld.Get();
    let none: EntityID;
    if !IsDefined(world) || !IsDefined(spec) {
      return none;
    }
    world.m_spawns += 1;
    let tag = StringToName("REDnode.spawn." + IntToString(world.m_spawns));
    ArrayPush(spec.tags, n"REDnode");
    ArrayPush(spec.tags, tag);
    for component in components {
      if IsDefined(component) {
        ArrayPush(world.m_pendingTag, tag);
        ArrayPush(world.m_pendingComponent, component);
      }
    }
    return GameInstance.GetDynamicEntitySystem().CreateEntity(spec);
  }

  // Removes an entity REDnode spawned.
  public static func Delete(entityID: EntityID) -> Bool {
    if !REDnodeWorld.Ready() {
      return false;
    }
    return GameInstance.GetDynamicEntitySystem().DeleteEntity(entityID);
  }

  // Places an entity: once a frame while the player drags it, for example.
  public static func Move(entityID: EntityID, position: Vector4, orientation: Quaternion) -> Bool {
    let entity = GameInstance.FindEntityByID(GetGameInstance(), entityID);
    if !IsDefined(entity) {
      return false;
    }
    let transform: WorldTransform;
    WorldTransform.SetPosition(transform, position);
    WorldTransform.SetOrientation(transform, orientation);
    entity.SetWorldTransform(transform);
    return true;
  }

  // Entity events for an entity REDnode did not spawn.
  public static func Watch(entityID: EntityID) -> Bool {
    let world = REDnodeWorld.Get();
    if !IsDefined(world) || !EntityID.IsDefined(entityID) {
      return false;
    }
    world.m_initialize.AddTarget(EntityTarget.ID(entityID));
    world.m_attach.AddTarget(EntityTarget.ID(entityID));
    world.m_detach.AddTarget(EntityTarget.ID(entityID));
    return true;
  }

  // The entity has its ID and has not gathered its components yet: the moment to add ours.
  private cb func OnEntityInitialize(event: ref<EntityLifecycleEvent>) {
    let entity = event.GetEntity();
    if !IsDefined(entity) {
      return;
    }
    let tags = GameInstance.GetDynamicEntitySystem().GetTags(entity.GetEntityID());
    let i = 0;
    while i < ArraySize(this.m_pendingTag) {
      if ArrayContains(tags, this.m_pendingTag[i]) {
        entity.AddComponent(this.m_pendingComponent[i]);
        ArrayErase(this.m_pendingTag, i);
        ArrayErase(this.m_pendingComponent, i);
      } else {
        i += 1;
      }
    }
    REDnodeWorld.Send("Entity/Initialize", entity);
  }

  private cb func OnEntityAttached(event: ref<EntityLifecycleEvent>) {
    REDnodeWorld.Send("Entity/AfterAttach", event.GetEntity());
  }

  private cb func OnEntityDetach(event: ref<EntityLifecycleEvent>) {
    REDnodeWorld.Send("Entity/Detach", event.GetEntity());
  }

  private static func Send(name: String, entity: wref<Entity>) {
    if IsDefined(entity) {
      // The EntityID itself: EntityID.GetHash gives only 32 of its 64 bits.
      REDnode_EntityEvent(name, entity.GetEntityID(), entity.GetClassName());
    }
  }
}
