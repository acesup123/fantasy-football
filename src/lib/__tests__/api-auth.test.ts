import { describe, expect, it } from "vitest";
import { canActAs } from "../api-auth";

const owner = (id: string, is_commissioner = false) => ({ id, is_commissioner });

describe("canActAs", () => {
  it("lets an owner act as themselves", () => {
    expect(canActAs(owner("a"), "a")).toBe(true);
  });

  it("blocks acting as another owner", () => {
    // This is the impersonation the routes were open to: owner_id arrived in
    // the request body and was trusted, so any caller could pick, elect keepers
    // or propose trades as anyone else.
    expect(canActAs(owner("a"), "b")).toBe(false);
  });

  it("lets the commissioner act for anyone", () => {
    expect(canActAs(owner("commish", true), "b")).toBe(true);
    expect(canActAs(owner("commish", true), "commish")).toBe(true);
  });

  it("does not treat a blank claimed id as a match", () => {
    expect(canActAs(owner("a"), "")).toBe(false);
  });
});
