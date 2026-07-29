#define _POSIX_C_SOURCE 200809L

#include <ApplicationServices/ApplicationServices.h>

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static const long kPollIntervalNanoseconds = 20L * 1000L * 1000L;
static const uint64_t kScrollInitialRepeatDelayMilliseconds = 350;
static const uint64_t kScrollRepeatIntervalMilliseconds = 80;

// macOS virtual key codes. Fn+Up/Down can be exposed as either the physical
// arrow or its Page Up/Down translation, depending on the keyboard.
static const CGKeyCode kKeyCodePageUp = 116;
static const CGKeyCode kKeyCodePageDown = 121;
static const CGKeyCode kKeyCodeLeftArrow = 123;
static const CGKeyCode kKeyCodeRightArrow = 124;
static const CGKeyCode kKeyCodeDownArrow = 125;
static const CGKeyCode kKeyCodeUpArrow = 126;

typedef enum {
  HOTKEY_EVENT_NONE = 0,
  HOTKEY_EVENT_SCREENSHOT,
  HOTKEY_EVENT_SCROLL_UP,
  HOTKEY_EVENT_SCROLL_DOWN,
} HotkeyEvent;

typedef enum {
  SCROLL_DIRECTION_NONE = 0,
  SCROLL_DIRECTION_UP,
  SCROLL_DIRECTION_DOWN,
} ScrollDirection;

typedef struct {
  CGEventFlags flags;
  bool up_held;
  bool down_held;
} HotkeyInput;

typedef struct {
  bool initialized;
  bool screenshot_chord_held;
  bool scroll_chord_held;
  bool scroll_repeat_armed;
  ScrollDirection scroll_direction;
  uint64_t next_scroll_repeat_milliseconds;
} HotkeyState;

static const char *message_for_event(HotkeyEvent event);

static bool is_fn_held(CGEventFlags flags) {
  return (flags & kCGEventFlagMaskSecondaryFn) != 0;
}

static bool has_command_control_or_option(CGEventFlags flags) {
  const CGEventFlags forbidden = kCGEventFlagMaskCommand |
                                 kCGEventFlagMaskControl |
                                 kCGEventFlagMaskAlternate;

  return (flags & forbidden) != 0;
}

static bool is_screenshot_chord_held(HotkeyInput input) {
  return is_fn_held(input.flags) && (input.flags & kCGEventFlagMaskShift) != 0;
}

static bool is_screenshot_allowed(HotkeyInput input) {
  return is_screenshot_chord_held(input) &&
         !has_command_control_or_option(input.flags) && !input.up_held &&
         !input.down_held;
}

static bool is_scroll_chord_held(HotkeyInput input) {
  return is_fn_held(input.flags) && (input.up_held || input.down_held);
}

static ScrollDirection allowed_scroll_direction(HotkeyInput input) {
  const bool shift_held = (input.flags & kCGEventFlagMaskShift) != 0;

  if (!is_scroll_chord_held(input) ||
      has_command_control_or_option(input.flags) || shift_held ||
      input.up_held == input.down_held) {
    return SCROLL_DIRECTION_NONE;
  }

  return input.up_held ? SCROLL_DIRECTION_UP : SCROLL_DIRECTION_DOWN;
}

static HotkeyEvent event_for_direction(ScrollDirection direction) {
  if (direction == SCROLL_DIRECTION_UP) {
    return HOTKEY_EVENT_SCROLL_UP;
  }
  if (direction == SCROLL_DIRECTION_DOWN) {
    return HOTKEY_EVENT_SCROLL_DOWN;
  }
  return HOTKEY_EVENT_NONE;
}

static HotkeyEvent update_hotkey_state(HotkeyState *state, HotkeyInput input,
                                       uint64_t now_milliseconds) {
  HotkeyEvent event = HOTKEY_EVENT_NONE;
  const bool screenshot_chord_held = is_screenshot_chord_held(input);
  const bool scroll_chord_held = is_scroll_chord_held(input);
  const ScrollDirection scroll_direction = allowed_scroll_direction(input);

  if (state->initialized && screenshot_chord_held &&
      !state->screenshot_chord_held && is_screenshot_allowed(input)) {
    event = HOTKEY_EVENT_SCREENSHOT;
  }

  if (!state->initialized) {
    state->scroll_repeat_armed = false;
  } else if (scroll_chord_held && !state->scroll_chord_held) {
    if (scroll_direction != SCROLL_DIRECTION_NONE) {
      state->scroll_repeat_armed = true;
      state->scroll_direction = scroll_direction;
      state->next_scroll_repeat_milliseconds =
          now_milliseconds + kScrollInitialRepeatDelayMilliseconds;
      event = event_for_direction(scroll_direction);
    } else {
      state->scroll_repeat_armed = false;
    }
  } else if (!scroll_chord_held) {
    state->scroll_repeat_armed = false;
    state->scroll_direction = SCROLL_DIRECTION_NONE;
    state->next_scroll_repeat_milliseconds = 0;
  } else if (state->scroll_repeat_armed) {
    if (scroll_direction != state->scroll_direction) {
      state->scroll_repeat_armed = false;
    } else if (now_milliseconds >= state->next_scroll_repeat_milliseconds) {
      state->next_scroll_repeat_milliseconds =
          now_milliseconds + kScrollRepeatIntervalMilliseconds;
      event = event_for_direction(scroll_direction);
    }
  }

  state->initialized = true;
  state->screenshot_chord_held = screenshot_chord_held;
  state->scroll_chord_held = scroll_chord_held;
  return event;
}

static const char *event_name(HotkeyEvent event) {
  switch (event) {
  case HOTKEY_EVENT_NONE:
    return "none";
  case HOTKEY_EVENT_SCREENSHOT:
    return "screenshot";
  case HOTKEY_EVENT_SCROLL_UP:
    return "scroll-up";
  case HOTKEY_EVENT_SCROLL_DOWN:
    return "scroll-down";
  }
  return "unknown";
}

static bool run_sequence(const HotkeyInput inputs[],
                         const uint64_t milliseconds[],
                         const HotkeyEvent expected[], size_t count,
                         const char *name) {
  HotkeyState state = {0};

  for (size_t index = 0; index < count; ++index) {
    const HotkeyEvent actual =
        update_hotkey_state(&state, inputs[index], milliseconds[index]);
    if (actual != expected[index]) {
      fprintf(stderr,
              "self-test failed: %s at step %zu (expected %s, got %s)\n", name,
              index, event_name(expected[index]), event_name(actual));
      return false;
    }
  }

  return true;
}

static int run_self_test(void) {
  const CGEventFlags fn = kCGEventFlagMaskSecondaryFn;
  const CGEventFlags fn_shift = fn | kCGEventFlagMaskShift;
  const uint64_t short_times[] = {0, 20, 40, 60, 80, 100};

  const struct {
    HotkeyEvent event;
    const char *expected;
  } protocol_cases[] = {
      {HOTKEY_EVENT_SCREENSHOT, "screenshot\n"},
      {HOTKEY_EVENT_SCROLL_UP, "scroll-up\n"},
      {HOTKEY_EVENT_SCROLL_DOWN, "scroll-down\n"},
  };
  const size_t protocol_case_count =
      sizeof(protocol_cases) / sizeof(protocol_cases[0]);
  for (size_t index = 0; index < protocol_case_count; ++index) {
    const char *actual = message_for_event(protocol_cases[index].event);
    if (actual == NULL || strcmp(actual, protocol_cases[index].expected) != 0) {
      fprintf(stderr, "self-test failed: protocol %s\n",
              event_name(protocol_cases[index].event));
      return EXIT_FAILURE;
    }
  }
  if (message_for_event(HOTKEY_EVENT_NONE) != NULL) {
    fputs("self-test failed: protocol none\n", stderr);
    return EXIT_FAILURE;
  }

  const struct {
    const char *name;
    HotkeyInput input;
    bool expected;
  } screenshot_cases[] = {
      {"no modifiers", {0, false, false}, false},
      {"fn only", {fn, false, false}, false},
      {"shift only", {kCGEventFlagMaskShift, false, false}, false},
      {"fn + shift", {fn_shift, false, false}, true},
      {"fn + shift + command",
       {fn_shift | kCGEventFlagMaskCommand, false, false},
       false},
      {"fn + shift + control",
       {fn_shift | kCGEventFlagMaskControl, false, false},
       false},
      {"fn + shift + option",
       {fn_shift | kCGEventFlagMaskAlternate, false, false},
       false},
      {"fn + shift + up", {fn_shift, true, false}, false},
      {"fn + shift + down", {fn_shift, false, true}, false},
      {"fn + shift + horizontal direction", {fn_shift, true, true}, false},
      {"fn + shift + caps lock",
       {fn_shift | kCGEventFlagMaskAlphaShift, false, false},
       true},
  };

  const size_t screenshot_case_count =
      sizeof(screenshot_cases) / sizeof(screenshot_cases[0]);
  for (size_t index = 0; index < screenshot_case_count; ++index) {
    const bool actual = is_screenshot_allowed(screenshot_cases[index].input);
    if (actual != screenshot_cases[index].expected) {
      fprintf(stderr, "self-test failed: screenshot predicate %s\n",
              screenshot_cases[index].name);
      return EXIT_FAILURE;
    }
  }

  const struct {
    const char *name;
    HotkeyInput input;
    ScrollDirection expected;
  } scroll_cases[] = {
      {"no modifiers", {0, true, false}, SCROLL_DIRECTION_NONE},
      {"fn only", {fn, false, false}, SCROLL_DIRECTION_NONE},
      {"fn + up", {fn, true, false}, SCROLL_DIRECTION_UP},
      {"fn + down", {fn, false, true}, SCROLL_DIRECTION_DOWN},
      {"fn + both directions", {fn, true, true}, SCROLL_DIRECTION_NONE},
      {"fn + shift + up", {fn_shift, true, false}, SCROLL_DIRECTION_NONE},
      {"fn + command + up",
       {fn | kCGEventFlagMaskCommand, true, false},
       SCROLL_DIRECTION_NONE},
      {"fn + control + down",
       {fn | kCGEventFlagMaskControl, false, true},
       SCROLL_DIRECTION_NONE},
      {"fn + option + down",
       {fn | kCGEventFlagMaskAlternate, false, true},
       SCROLL_DIRECTION_NONE},
      {"fn + caps lock + up",
       {fn | kCGEventFlagMaskAlphaShift, true, false},
       SCROLL_DIRECTION_UP},
  };

  const size_t scroll_case_count =
      sizeof(scroll_cases) / sizeof(scroll_cases[0]);
  for (size_t index = 0; index < scroll_case_count; ++index) {
    const ScrollDirection actual =
        allowed_scroll_direction(scroll_cases[index].input);
    if (actual != scroll_cases[index].expected) {
      fprintf(stderr, "self-test failed: scroll predicate %s\n",
              scroll_cases[index].name);
      return EXIT_FAILURE;
    }
  }

  const HotkeyInput screenshot_inputs[] = {
      {0, false, false},
      {kCGEventFlagMaskShift, false, false},
      {fn_shift, false, false},
      {fn_shift, false, false},
      {kCGEventFlagMaskShift, false, false},
      {fn_shift, false, false},
  };
  const HotkeyEvent screenshot_expected[] = {
      HOTKEY_EVENT_NONE, HOTKEY_EVENT_NONE, HOTKEY_EVENT_SCREENSHOT,
      HOTKEY_EVENT_NONE, HOTKEY_EVENT_NONE, HOTKEY_EVENT_SCREENSHOT,
  };
  if (!run_sequence(screenshot_inputs, short_times, screenshot_expected,
                    sizeof(screenshot_inputs) / sizeof(screenshot_inputs[0]),
                    "screenshot rising edges")) {
    return EXIT_FAILURE;
  }

  const HotkeyInput screenshot_startup_inputs[] = {
      {fn_shift, false, false},
      {fn_shift, false, false},
      {kCGEventFlagMaskShift, false, false},
      {fn_shift, false, false},
  };
  const uint64_t screenshot_startup_times[] = {0, 20, 40, 60};
  const HotkeyEvent screenshot_startup_expected[] = {
      HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_SCREENSHOT,
  };
  if (!run_sequence(screenshot_startup_inputs, screenshot_startup_times,
                    screenshot_startup_expected,
                    sizeof(screenshot_startup_inputs) /
                        sizeof(screenshot_startup_inputs[0]),
                    "screenshot startup baseline")) {
    return EXIT_FAILURE;
  }

  const HotkeyInput screenshot_blocked_inputs[] = {
      {0, false, false},        {fn_shift, true, false},
      {fn_shift, false, false}, {kCGEventFlagMaskShift, false, false},
      {fn_shift, false, false},
  };
  const uint64_t screenshot_blocked_times[] = {0, 20, 40, 60, 80};
  const HotkeyEvent screenshot_blocked_expected[] = {
      HOTKEY_EVENT_NONE, HOTKEY_EVENT_NONE,       HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_NONE, HOTKEY_EVENT_SCREENSHOT,
  };
  if (!run_sequence(screenshot_blocked_inputs, screenshot_blocked_times,
                    screenshot_blocked_expected,
                    sizeof(screenshot_blocked_inputs) /
                        sizeof(screenshot_blocked_inputs[0]),
                    "screenshot blocked by direction")) {
    return EXIT_FAILURE;
  }

  const HotkeyInput scroll_repeat_inputs[] = {
      {0, false, false}, {fn, true, false},  {fn, true, false},
      {fn, true, false}, {fn, true, false},  {fn, true, false},
      {fn, true, false}, {fn, false, false}, {fn, false, true},
  };
  const uint64_t scroll_repeat_times[] = {0,   20,  369, 370, 449,
                                          450, 700, 720, 740};
  const HotkeyEvent scroll_repeat_expected[] = {
      HOTKEY_EVENT_NONE,      HOTKEY_EVENT_SCROLL_UP, HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_SCROLL_UP, HOTKEY_EVENT_NONE,      HOTKEY_EVENT_SCROLL_UP,
      HOTKEY_EVENT_SCROLL_UP, HOTKEY_EVENT_NONE,      HOTKEY_EVENT_SCROLL_DOWN,
  };
  if (!run_sequence(
          scroll_repeat_inputs, scroll_repeat_times, scroll_repeat_expected,
          sizeof(scroll_repeat_inputs) / sizeof(scroll_repeat_inputs[0]),
          "scroll initial press and repeat")) {
    return EXIT_FAILURE;
  }

  const HotkeyInput startup_held_inputs[] = {
      {fn, true, false},
      {fn, true, false},
      {fn, false, false},
      {fn, true, false},
  };
  const uint64_t startup_held_times[] = {0, 1000, 1020, 1040};
  const HotkeyEvent startup_held_expected[] = {
      HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_SCROLL_UP,
  };
  if (!run_sequence(
          startup_held_inputs, startup_held_times, startup_held_expected,
          sizeof(startup_held_inputs) / sizeof(startup_held_inputs[0]),
          "scroll startup baseline")) {
    return EXIT_FAILURE;
  }

  const HotkeyInput blocker_inputs[] = {
      {0, false, false}, {fn | kCGEventFlagMaskCommand, true, false},
      {fn, true, false}, {fn, false, false},
      {fn, true, false}, {fn | kCGEventFlagMaskControl, true, false},
      {fn, true, false}, {fn, false, false},
      {fn, true, false},
  };
  const uint64_t blocker_times[] = {0, 20, 400, 420, 440, 460, 900, 920, 940};
  const HotkeyEvent blocker_expected[] = {
      HOTKEY_EVENT_NONE, HOTKEY_EVENT_NONE,      HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_NONE, HOTKEY_EVENT_SCROLL_UP, HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_NONE, HOTKEY_EVENT_NONE,      HOTKEY_EVENT_SCROLL_UP,
  };
  if (!run_sequence(blocker_inputs, blocker_times, blocker_expected,
                    sizeof(blocker_inputs) / sizeof(blocker_inputs[0]),
                    "scroll modifier blockers")) {
    return EXIT_FAILURE;
  }

  const HotkeyInput ambiguous_inputs[] = {
      {0, false, false},  {fn, true, true},  {fn, false, true},
      {fn, false, false}, {fn, false, true},
  };
  const uint64_t ambiguous_times[] = {0, 20, 400, 420, 440};
  const HotkeyEvent ambiguous_expected[] = {
      HOTKEY_EVENT_NONE, HOTKEY_EVENT_NONE,        HOTKEY_EVENT_NONE,
      HOTKEY_EVENT_NONE, HOTKEY_EVENT_SCROLL_DOWN,
  };
  if (!run_sequence(ambiguous_inputs, ambiguous_times, ambiguous_expected,
                    sizeof(ambiguous_inputs) / sizeof(ambiguous_inputs[0]),
                    "ambiguous directions")) {
    return EXIT_FAILURE;
  }

  puts("self-test passed");
  return EXIT_SUCCESS;
}

static const char *message_for_event(HotkeyEvent event) {
  switch (event) {
  case HOTKEY_EVENT_SCREENSHOT:
    return "screenshot\n";
  case HOTKEY_EVENT_SCROLL_UP:
    return "scroll-up\n";
  case HOTKEY_EVENT_SCROLL_DOWN:
    return "scroll-down\n";
  case HOTKEY_EVENT_NONE:
    return NULL;
  }
  return NULL;
}

static bool write_event(HotkeyEvent event) {
  const char *message = message_for_event(event);
  if (message == NULL) {
    return true;
  }

  const size_t message_length = strlen(message);
  size_t offset = 0;
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

static uint64_t monotonic_milliseconds(void) {
  struct timespec now = {0};
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
    return 0;
  }

  return (uint64_t)now.tv_sec * 1000U + (uint64_t)now.tv_nsec / (1000U * 1000U);
}

static bool key_is_held(CGKeyCode key_code) {
  return CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, key_code);
}

static HotkeyInput read_hotkey_input(void) {
  // Treat either horizontal arrow as both vertical directions. That makes the
  // chord unambiguously ineligible for scrolling while also preventing
  // Fn+Shift from firing when any arrow key is down.
  const bool horizontal_arrow_held =
      key_is_held(kKeyCodeLeftArrow) || key_is_held(kKeyCodeRightArrow);
  HotkeyInput input = {
      .flags = CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState),
      .up_held = horizontal_arrow_held || key_is_held(kKeyCodeUpArrow) ||
                 key_is_held(kKeyCodePageUp),
      .down_held = horizontal_arrow_held || key_is_held(kKeyCodeDownArrow) ||
                   key_is_held(kKeyCodePageDown),
  };
  return input;
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

    const HotkeyEvent event = update_hotkey_state(&state, read_hotkey_input(),
                                                  monotonic_milliseconds());
    if (event != HOTKEY_EVENT_NONE && !write_event(event)) {
      return EXIT_SUCCESS;
    }

    sleep_until_next_poll();
  }
}
