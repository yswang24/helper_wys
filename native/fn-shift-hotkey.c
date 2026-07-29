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

typedef struct {
  bool initialized;
  bool chord_held;
} HotkeyState;

static bool is_fn_shift_held(CGEventFlags flags) {
  const CGEventFlags required =
      kCGEventFlagMaskSecondaryFn | kCGEventFlagMaskShift;

  return (flags & required) == required;
}

static bool is_fn_shift_allowed(CGEventFlags flags) {
  const CGEventFlags forbidden = kCGEventFlagMaskCommand |
                                 kCGEventFlagMaskControl |
                                 kCGEventFlagMaskAlternate;

  return is_fn_shift_held(flags) && (flags & forbidden) == 0;
}

static bool update_hotkey_state(HotkeyState *state, CGEventFlags flags) {
  const bool chord_held = is_fn_shift_held(flags);
  const bool should_trigger = state->initialized && chord_held &&
                              !state->chord_held &&
                              is_fn_shift_allowed(flags);

  state->initialized = true;
  state->chord_held = chord_held;
  return should_trigger;
}

static bool run_sequence(const CGEventFlags flags[], const bool expected[],
                         size_t count, const char *name) {
  HotkeyState state = {0};

  for (size_t index = 0; index < count; ++index) {
    const bool actual = update_hotkey_state(&state, flags[index]);
    if (actual != expected[index]) {
      fprintf(stderr, "self-test failed: %s at step %zu\n", name, index);
      return false;
    }
  }

  return true;
}

static int run_self_test(void) {
  const CGEventFlags fn_shift =
      kCGEventFlagMaskSecondaryFn | kCGEventFlagMaskShift;
  const struct {
    const char *name;
    CGEventFlags flags;
    bool expected;
  } cases[] = {
      {"no modifiers", 0, false},
      {"fn only", kCGEventFlagMaskSecondaryFn, false},
      {"shift only", kCGEventFlagMaskShift, false},
      {"fn + shift", fn_shift, true},
      {"fn + shift + command", fn_shift | kCGEventFlagMaskCommand, false},
      {"fn + shift + control", fn_shift | kCGEventFlagMaskControl, false},
      {"fn + shift + option", fn_shift | kCGEventFlagMaskAlternate, false},
      {"fn + shift + caps lock", fn_shift | kCGEventFlagMaskAlphaShift, true},
  };

  const size_t case_count = sizeof(cases) / sizeof(cases[0]);
  for (size_t index = 0; index < case_count; ++index) {
    const bool actual = is_fn_shift_allowed(cases[index].flags);
    if (actual != cases[index].expected) {
      fprintf(stderr, "self-test failed: predicate %s\n", cases[index].name);
      return EXIT_FAILURE;
    }
  }

  const CGEventFlags plain_sequence[] = {
      0,
      kCGEventFlagMaskShift,
      fn_shift,
      fn_shift,
      kCGEventFlagMaskShift,
      fn_shift,
  };
  const bool plain_expected[] = {false, false, true, false, false, true};
  if (!run_sequence(plain_sequence, plain_expected,
                    sizeof(plain_sequence) / sizeof(plain_sequence[0]),
                    "plain rising edges")) {
    return EXIT_FAILURE;
  }

  const CGEventFlags startup_held_sequence[] = {
      fn_shift,
      fn_shift,
      kCGEventFlagMaskShift,
      fn_shift,
  };
  const bool startup_held_expected[] = {false, false, false, true};
  if (!run_sequence(
          startup_held_sequence, startup_held_expected,
          sizeof(startup_held_sequence) / sizeof(startup_held_sequence[0]),
          "startup baseline")) {
    return EXIT_FAILURE;
  }

  const CGEventFlags blocked_entry_sequence[] = {
      0,
      kCGEventFlagMaskControl,
      fn_shift | kCGEventFlagMaskControl,
      fn_shift,
      kCGEventFlagMaskShift,
      fn_shift,
  };
  const bool blocked_entry_expected[] = {false, false, false,
                                         false, false, true};
  if (!run_sequence(
          blocked_entry_sequence, blocked_entry_expected,
          sizeof(blocked_entry_sequence) / sizeof(blocked_entry_sequence[0]),
          "blocked chord entry")) {
    return EXIT_FAILURE;
  }

  const CGEventFlags blocker_after_trigger_sequence[] = {
      0,
      fn_shift,
      fn_shift | kCGEventFlagMaskControl,
      fn_shift,
      0,
      fn_shift | kCGEventFlagMaskAlphaShift,
  };
  const bool blocker_after_trigger_expected[] = {false, true, false,
                                                 false, false, true};
  if (!run_sequence(
          blocker_after_trigger_sequence, blocker_after_trigger_expected,
          sizeof(blocker_after_trigger_sequence) /
              sizeof(blocker_after_trigger_sequence[0]),
          "blocker after trigger")) {
    return EXIT_FAILURE;
  }

  puts("self-test passed");
  return EXIT_SUCCESS;
}

static bool write_trigger(void) {
  static const char message[] = "trigger\n";
  size_t offset = 0;

  while (offset < sizeof(message) - 1) {
    const ssize_t written =
        write(STDOUT_FILENO, message + offset, sizeof(message) - 1 - offset);
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

    if (update_hotkey_state(&state, flags) && !write_trigger()) {
      return EXIT_SUCCESS;
    }

    sleep_until_next_poll();
  }
}
