import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeleteOwnedUnlinkedUnreservedImageAttachment } = vi.hoisted(() => ({
  mockDeleteOwnedUnlinkedUnreservedImageAttachment: vi.fn(),
}));

vi.mock("../../shared/db", async () => ({
  db: {},
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../shared/data/images.data", async (importActual) => ({
  ...(await importActual<typeof import("../../shared/data/images.data")>()),
  deleteOwnedUnlinkedUnreservedImageAttachment:
    mockDeleteOwnedUnlinkedUnreservedImageAttachment,
}));

import { createApp } from "../../api/app";
import { authedHeaders } from "../helpers/session";

const imageUploadId = "550e8400-e29b-41d4-a716-446655440000";

async function deleteImage(userId = "user_01OWNER") {
  return (await createApp()).request(
    `http://localhost/upload/image/${imageUploadId}`,
    {
      method: "DELETE",
      headers: await authedHeaders(userId),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteOwnedUnlinkedUnreservedImageAttachment.mockResolvedValue(undefined);
});

describe("DELETE /upload/image/:imageUploadId", () => {
  it("deletes an owned, unlinked, unreserved image attachment", async () => {
    const response = await deleteImage();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Image deleted" });
    expect(
      mockDeleteOwnedUnlinkedUnreservedImageAttachment,
    ).toHaveBeenCalledWith("user_01OWNER", imageUploadId);
  });

  it("rejects an invalid upload id", async () => {
    const response = await (
      await createApp()
    ).request("http://localhost/upload/image/not-a-uuid", {
      method: "DELETE",
      headers: await authedHeaders("user_01OWNER"),
    });

    expect(response.status).toBe(400);
    expect(
      mockDeleteOwnedUnlinkedUnreservedImageAttachment,
    ).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const response = await (
      await createApp()
    ).request(`http://localhost/upload/image/${imageUploadId}`, {
      method: "DELETE",
      headers: { Origin: process.env.CLIENT_URL! },
    });

    expect(response.status).toBe(401);
    expect(
      mockDeleteOwnedUnlinkedUnreservedImageAttachment,
    ).not.toHaveBeenCalled();
  });

  it("reports deletion failures", async () => {
    mockDeleteOwnedUnlinkedUnreservedImageAttachment.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    const response = await deleteImage();

    expect(response.status).toBe(500);
  });
});
