import LiveKitClient from "./LiveKitClient.js";
import { LANG_NAME, MODULE_NAME } from "./utils/constants";

import { Logger } from "./utils/logger.js";

const log = new Logger("LiveKitBreakout");

export function getBreakoutRoom(userId: string): string | undefined {
  const breakoutRoomRegistry =
    game.settings?.get(MODULE_NAME, "breakoutRoomRegistry") ?? {};

  return breakoutRoomRegistry[userId];
}

export async function setBreakoutRoom(
  userId: string,
  breakoutRoom?: string,
): Promise<void> {
  const breakoutRoomRegistry =
    game.settings?.get(MODULE_NAME, "breakoutRoomRegistry") ?? {};
  breakoutRoomRegistry[userId] = breakoutRoom;
  await game.settings?.set(
    MODULE_NAME,
    "breakoutRoomRegistry",
    breakoutRoomRegistry,
  );
}

/**
 * A breakout room action on a user, for the players list and the camera dock
 * menus.
 */
export interface BreakoutAction {
  label: string;
  /** A Font Awesome icon class, e.g. "fa-comment" */
  icon: string;
  run: () => void;
}

/**
 * The breakout room actions available for a user.
 */
export function getBreakoutActions(
  userId: string,
  liveKitClient: LiveKitClient,
): BreakoutAction[] {
  const isGM = game.user?.isGM === true;
  const isSelf = userId === game.user?.id;
  const userBreakoutRoom = getBreakoutRoom(userId);
  const localize = (key: string) =>
    game.i18n?.localize(`${LANG_NAME}.${key}`) ?? key;
  const actions: (BreakoutAction | false)[] = [
    isGM &&
      !isSelf &&
      !userBreakoutRoom && {
        label: localize("startAVBreakout"),
        icon: "fa-comment",
        run: () => {
          const breakoutRoom = foundry.utils.randomID(32);
          _startBreakout(userId, breakoutRoom);
          breakout(breakoutRoom, liveKitClient);
        },
      },
    isGM &&
      !isSelf &&
      !!userBreakoutRoom &&
      liveKitClient.breakoutRoom !== userBreakoutRoom && {
        label: localize("joinAVBreakout"),
        icon: "fa-comment-dots",
        run: () => {
          breakout(userBreakoutRoom, liveKitClient);
        },
      },
    isGM &&
      !isSelf &&
      !!liveKitClient.breakoutRoom &&
      userBreakoutRoom !== liveKitClient.breakoutRoom && {
        label: localize("pullToAVBreakout"),
        icon: "fa-comments",
        run: () => {
          _startBreakout(userId, liveKitClient.breakoutRoom);
        },
      },
    isSelf &&
      !!liveKitClient.breakoutRoom && {
        label: localize("leaveAVBreakout"),
        icon: "fa-comment-slash",
        run: () => {
          breakout(undefined, liveKitClient);
        },
      },
    isGM &&
      !isSelf &&
      !!userBreakoutRoom && {
        label: localize("removeFromAVBreakout"),
        icon: "fa-comment-slash",
        run: () => {
          _endUserBreakout(userId);
        },
      },
    isGM &&
      isSelf && {
        label: localize("endAllAVBreakouts"),
        icon: "fa-ban",
        run: () => {
          _endAllBreakouts(liveKitClient);
        },
      },
  ];
  return actions.filter((action) => action !== false);
}

export function addContextOptions(
  contextOptions: foundry.applications.ux.ContextMenu.Entry<HTMLElement>[],
  liveKitClient: LiveKitClient,
): void {
  // Add breakout options to the player list context menus. The actions
  // depend on the user, so each entry looks its action up by label.
  const actionFor = (players: HTMLElement, label: string) =>
    getBreakoutActions(players.dataset.userId ?? "", liveKitClient).find(
      (action) => action.label === label,
    );
  const entries: [string, string][] = [
    ["startAVBreakout", "fa-comment"],
    ["joinAVBreakout", "fa-comment-dots"],
    ["pullToAVBreakout", "fa-comments"],
    ["leaveAVBreakout", "fa-comment-slash"],
    ["removeFromAVBreakout", "fa-comment-slash"],
    ["endAllAVBreakouts", "fa-ban"],
  ];
  for (const [key, icon] of entries) {
    const label = game.i18n?.localize(`${LANG_NAME}.${key}`) ?? key;
    contextOptions.push({
      name: label,
      icon: `<i class="fa-solid ${icon}"></i>`,
      condition: (players) => !!actionFor(players, label),
      callback: (players) => {
        actionFor(players, label)?.run();
      },
    });
  }
}

export function breakout(
  breakoutRoom: string | undefined,
  liveKitClient: LiveKitClient,
): void {
  if (breakoutRoom === liveKitClient.breakoutRoom) {
    // Already in this room, skip
    return;
  }

  if (!breakoutRoom) {
    ui.notifications?.info(
      game.i18n?.localize(`${LANG_NAME}.leavingAVBreakout`) ??
        "leavingAVBreakout",
    );
  } else {
    ui.notifications?.info(
      game.i18n?.localize(`${LANG_NAME}.joiningAVBreakout`) ??
        "joiningAVBreakout",
    );
  }

  log.debug("Switching to breakout room:", breakoutRoom);
  liveKitClient.breakoutRoom = breakoutRoom;
  game.webrtc?.connect().catch(() => {
    log.error("Failed to connect to breakout room");
    liveKitClient.breakoutRoom = undefined;
    ui.notifications?.error(
      game.i18n.localize(`${LANG_NAME}.failedToJoinAVBreakout`),
    );
  });
}

function _startBreakout(
  userId: string,
  breakoutRoom: string | undefined,
): void {
  if (!game.user?.isGM) {
    log.warn("Only a GM can start a breakout conference room");
    return;
  }

  setBreakoutRoom(userId, breakoutRoom).catch((error: unknown) => {
    log.error("Error setting breakout room:", error);
  });

  game.socket.emit(
    `module.${MODULE_NAME}`,
    {
      action: "breakout",
      userId,
      breakoutRoom,
    },
    { recipients: [userId] },
  );
}

function _endUserBreakout(userId: string) {
  if (!game.user?.isGM) {
    log.warn("Only a GM can end a user's breakout conference");
    return;
  }

  setBreakoutRoom(userId, undefined).catch((error: unknown) => {
    log.error("Error clearing breakout room:", error);
  });
  game.socket.emit(
    `module.${MODULE_NAME}`,
    {
      action: "breakout",
      userId,
      breakoutRoom: undefined,
    },
    { recipients: [userId] },
  );
}

function _endAllBreakouts(liveKitClient: LiveKitClient): void {
  if (!game.user?.isGM) {
    log.warn("Only a GM can end all breakout conference rooms");
    return;
  }

  game.socket.emit(`module.${MODULE_NAME}`, {
    action: "breakout",
    userId: undefined,
    breakoutRoom: undefined,
  });

  if (liveKitClient.breakoutRoom) {
    breakout(undefined, liveKitClient);
  }
}
