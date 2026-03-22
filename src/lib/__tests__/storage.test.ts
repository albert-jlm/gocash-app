import { describe, expect, it } from "vitest";
import {
  buildTransactionImagePath,
  mimeTypeToExtension,
  TRANSACTION_IMAGE_BUCKET,
} from "../../../supabase/functions/_shared/storage";

describe("storage helpers", () => {
  it("returns the private transaction image bucket name", () => {
    expect(TRANSACTION_IMAGE_BUCKET).toBe("transaction-images");
  });

  it("maps mime types to extensions", () => {
    expect(mimeTypeToExtension("image/jpeg")).toBe("jpg");
    expect(mimeTypeToExtension("image/png")).toBe("png");
    expect(mimeTypeToExtension("image/heic")).toBe("heic");
    expect(mimeTypeToExtension("application/octet-stream")).toBe("jpg");
  });

  it("builds deterministic storage paths when a unique id is supplied", () => {
    expect(buildTransactionImagePath("operator-1", "image/png", "tx-1")).toBe("operator-1/tx-1.png");
  });
});

