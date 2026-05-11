/**
 * ExportService テスト
 *
 * 1. exportTranscript は TRANSCRIPT_EXPORT_NOT_IMPLEMENTED を返す（stub）
 * 2. format によらず同じエラーを返す
 */

import { describe, it, expect } from "vitest";
import { createExportService } from "../src/services/export-service.js";
import { brandRoomId, brandUserId } from "@trancall/shared-kernel";

function mustOk<T>(result: { success: boolean; data?: T }): T {
  if (!result.success || result.data === undefined) {
    throw new Error("brand parse failed");
  }
  return result.data;
}

const ROOM_ID = mustOk(brandRoomId("f47ac10b-58cc-4372-a567-0e02b2c3d479"));
const USER_ID = mustOk(brandUserId("f47ac10b-58cc-4372-a567-0e02b2c3d482"));

describe("ExportService (stub)", () => {
  const service = createExportService();

  it("test-1: pdf フォーマットは TRANSCRIPT_EXPORT_NOT_IMPLEMENTED を返す", async () => {
    const result = await service.exportTranscript(ROOM_ID, USER_ID, "pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSCRIPT_EXPORT_NOT_IMPLEMENTED");
    }
  });

  it("test-2: txt フォーマットは TRANSCRIPT_EXPORT_NOT_IMPLEMENTED を返す", async () => {
    const result = await service.exportTranscript(ROOM_ID, USER_ID, "txt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSCRIPT_EXPORT_NOT_IMPLEMENTED");
    }
  });
});
