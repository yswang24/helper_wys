#define _POSIX_C_SOURCE 200809L

#include <ApplicationServices/ApplicationServices.h>

#include <errno.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static const long kPollIntervalNanoseconds = 20L * 1000L * 1000L;

typedef enum {
  HOTKEY_NONE = 0,
  HOTKEY_CONTROL,
  HOTKEY_SHIFT,
  HOTKEY_OPTION,
  HOTKEY_COMMAND,
} HotkeyEvent;

typedef struct {
  bool initialized;
  bool chord_held;
} HotkeyState;

static HotkeyEvent get_hotkey_event(CGEventFlags flags) {
  if ((flags & kCGEventFlagMaskSecondaryFn) == 0) return HOTKEY_NONE;

  const CGEventFlags targets =
      flags & (kCGEventFlagMaskControl | kCGEventFlagMaskShift |
               kCGEventFlagMaskAlternate | kCGEventFlagMaskCommand);

  if (targets == kCGEventFlagMaskControl) return HOTKEY_CONTROL;
  if (targets == kCGEventFlagMaskShift) return HOTKEY_SHIFT;
  if (targets == kCGEventFlagMaskAlternate) return HOTKEY_OPTION;
  if (targets == kCGEventFlagMaskCommand) return HOTKEY_COMMAND;
  return HOTKEY_NONE;
}

static HotkeyEvent update_hotkey_state(HotkeyState *state,
                                       CGEventFlags flags) {
  const CGEventFlags targets =
      flags & (kCGEventFlagMaskControl | kCGEventFlagMaskShift |
               kCGEventFlagMaskAlternate | kCGEventFlagMaskCommand);
  const bool chord_held = (flags & kCGEventFlagMaskSecondaryFn) != 0 &&
                          targets != 0;
  const HotkeyEvent event =
      state->initialized && chord_held && !state->chord_held
          ? get_hotkey_event(flags)
          : HOTKEY_NONE;

  state->initialized = true;
  state->chord_held = chord_held;
  return event;
}

static bool run_sequence(const CGEventFlags flags[],
                         const HotkeyEvent expected[], size_t count,
                         const char *name) {
  HotkeyState state = {0};

  for (size_t index = 0; index < count; ++index) {
    const HotkeyEvent actual = update_hotkey_state(&state, flags[index]);
    if (actual != expected[index]) {
      fprintf(stderr, "self-test failed: %s at step %zu\n", name, index);
      return false;
    }
  }

  return true;
}

static int run_self_test(void) {
  const CGEventFlags fn = kCGEventFlagMaskSecondaryFn;
  const CGEventFlags control = kCGEventFlagMaskControl;
  const CGEventFlags shift = kCGEventFlagMaskShift;
  const CGEventFlags option = kCGEventFlagMaskAlternate;
  const CGEventFlags command = kCGEventFlagMaskCommand;
  const struct {
    const char *name;
    CGEventFlags flags;
    HotkeyEvent expected;
  } cases[] = {
      {"no modifiers", 0, HOTKEY_NONE},
      {"fn alone", fn, HOTKEY_NONE},
      {"fn + control", fn | control, HOTKEY_CONTROL},
      {"fn + shift", fn | shift, HOTKEY_SHIFT},
      {"fn + option", fn | option, HOTKEY_OPTION},
      {"fn + command", fn | command, HOTKEY_COMMAND},
      {"fn + shift + command", fn | shift | command, HOTKEY_NONE},
      {"fn + shift + caps lock", fn | shift | kCGEventFlagMaskAlphaShift,
       HOTKEY_SHIFT},
  };

  const size_t case_count = sizeof(cases) / sizeof(cases[0]);
  for (size_t index = 0; index < case_count; ++index) {
    const HotkeyEvent actual = get_hotkey_event(cases[index].flags);
    if (actual != cases[index].expected) {
      fprintf(stderr, "self-test failed: predicate %s\n", cases[index].name);
      return EXIT_FAILURE;
    }
  }

  const CGEventFlags startup_held_sequence[] = {
      fn | shift,
      fn | shift,
      shift,
      fn | shift,
  };
  const HotkeyEvent startup_held_expected[] = {
      HOTKEY_NONE,
      HOTKEY_NONE,
      HOTKEY_NONE,
      HOTKEY_SHIFT,
  };
  if (!run_sequence(
          startup_held_sequence, startup_held_expected,
          sizeof(startup_held_sequence) / sizeof(startup_held_sequence[0]),
          "startup-held chord")) {
    return EXIT_FAILURE;
  }

  const CGEventFlags held_chord_sequence[] = {
      0,
      fn | option,
      fn | option,
      0,
      fn | option,
  };
  const HotkeyEvent held_chord_expected[] = {
      HOTKEY_NONE,
      HOTKEY_OPTION,
      HOTKEY_NONE,
      HOTKEY_NONE,
      HOTKEY_OPTION,
  };
  if (!run_sequence(
          held_chord_sequence, held_chord_expected,
          sizeof(held_chord_sequence) / sizeof(held_chord_sequence[0]),
          "held chord debounce")) {
    return EXIT_FAILURE;
  }

  const CGEventFlags blocked_entry_sequence[] = {
      0,
      fn | shift | command,
      fn | shift,
      shift,
      fn | shift,
  };
  const HotkeyEvent blocked_entry_expected[] = {
      HOTKEY_NONE,
      HOTKEY_NONE,
      HOTKEY_NONE,
      HOTKEY_NONE,
      HOTKEY_SHIFT,
  };
  if (!run_sequence(
          blocked_entry_sequence, blocked_entry_expected,
          sizeof(blocked_entry_sequence) / sizeof(blocked_entry_sequence[0]),
          "blocked multi-modifier entry")) {
    return EXIT_FAILURE;
  }

  puts("self-test passed");
  return EXIT_SUCCESS;
}

static const char *hotkey_event_name(HotkeyEvent event) {
  switch (event) {
    case HOTKEY_CONTROL: return "control\n";
    case HOTKEY_SHIFT: return "shift\n";
    case HOTKEY_OPTION: return "option\n";
    case HOTKEY_COMMAND: return "command\n";
    case HOTKEY_NONE: return NULL;
  }
  return NULL;
}

static bool write_trigger(HotkeyEvent event) {
  const char *message = hotkey_event_name(event);
  if (message == NULL) return true;
  size_t offset = 0;
  const size_t message_length = strlen(message);

  while (offset < message_length) {
    const ssize_t written =
        write(STDOUT_FILENO, message + offset, message_length - offset);
    if (written > 0) {
      offset += (size_t)written;
      continue;
    }
    if (written < 0 && errno == EINTR) {
      continue;
    }
    return false;
  }

  return true;
}

static void sleep_until_next_poll(void) {
  struct timespec remaining = {
      .tv_sec = 0,
      .tv_nsec = kPollIntervalNanoseconds,
  };

  while (nanosleep(&remaining, &remaining) == -1 && errno == EINTR) {
  }
}

int main(int argc, char *argv[]) {
  if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
    return run_self_test();
  }
  if (argc != 1) {
    fprintf(stderr, "usage: %s [--self-test]\n", argv[0]);
    return EXIT_FAILURE;
  }

  const pid_t parent_pid = getppid();
  if (parent_pid <= 1) {
    return EXIT_SUCCESS;
  }

  HotkeyState state = {0};
  for (;;) {
    if (getppid() != parent_pid) {
      return EXIT_SUCCESS;
    }

    const CGEventFlags flags =
        CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState);

    const HotkeyEvent event = update_hotkey_state(&state, flags);
    if (event != HOTKEY_NONE && !write_trigger(event)) {
      return EXIT_SUCCESS;
    }

    sleep_until_next_poll();
  }
}
