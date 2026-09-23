/**
 * PROBE: the required "platform: Unknown" path — the model declines, and
 * `detectPlatform(raw_text)` has to recover the platform from the transcript.
 *
 * WHY IT BREAKS: the prompt tells the model to detect the platform from
 * BRANDING ("green branding", "purple/blue branding", "teal branding"), which
 * is the least stable signal on the screen. Dark mode, a cropped header, a
 * screenshot of a screenshot, or a system theme all destroy it. When that
 * happens the entire platform decision falls to one keyword scan of the
 * transcribed text — so this fallback is not an edge case, it is the load-
 * bearing path for every receipt where the logo did not survive.
 *
 * This one recovers correctly. maribank-to-gcash-platform-hijack is the same
 * fallback recovering the WRONG platform, and the two should be read together.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "unknown-platform-falls-back-to-gcash",
  probe: 'platform "Unknown" recovered by detectPlatform() from raw_text.',
  why: "Branding-based detection dies in dark mode; the keyword fallback carries the load.",
  expected: {
    platform: "GCash",
    transaction_type: "Cash In",
    amount_php: 300,
    reference_number: "2211009988776",
    account_number: "09085551212",
    fee_php: 6,
    postings: [
      { account: "cash", php: 306 },
      { account: "GCash", php: -300 },
      { account: "revenue", php: -6 },
    ],
  },
};
