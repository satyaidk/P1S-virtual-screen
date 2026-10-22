import { describe, expect, it } from "vitest";
import { BambuCloudClient, CloudError, usernameFromJwt } from "@/server/bambu-cloud";
import { fakeFetch, jsonResponse } from "../support/fake-fetch";

const jwt = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("BambuCloudClient", () => {
  it("returns the token when the password is accepted", async () => {
    const f = fakeFetch({
      "POST /v1/user-service/user/login": () =>
        jsonResponse({ accessToken: "tok", expiresIn: 100 }),
    });
    const res = await new BambuCloudClient("global", f.fetch).login("me@example.com", "pw");
    expect(res).toEqual({ kind: "token", token: "tok", expiresIn: 100 });
    expect(f.calls[0]!.url).toBe("https://api.bambulab.com/v1/user-service/user/login");
    expect(f.calls[0]!.body).toMatchObject({ account: "me@example.com", password: "pw" });
  });

  it("reports when an email code or 2FA is required", async () => {
    const code = fakeFetch({
      "POST /login": () => jsonResponse({ accessToken: "", loginType: "verifyCode" }),
    });
    expect(await new BambuCloudClient("global", code.fetch).login("a@b.c", "pw")).toEqual({
      kind: "verifyCode",
    });
    const tfa = fakeFetch({
      "POST /login": () => jsonResponse({ accessToken: "", loginType: "tfa", tfaKey: "k1" }),
    });
    expect(await new BambuCloudClient("global", tfa.fetch).login("a@b.c", "pw")).toEqual({
      kind: "tfa",
      tfaKey: "k1",
    });
  });

  it("surfaces Bambu's error message", async () => {
    const f = fakeFetch({
      "POST /login": () => jsonResponse({ code: 1, error: "Incorrect account or password." }, 400),
    });
    await expect(
      new BambuCloudClient("global", f.fetch).login("a@b.c", "bad"),
    ).rejects.toMatchObject({
      message: "Incorrect account or password.",
      status: 400,
      code: 1,
    });
  });

  it("detects Cloudflare blocks", async () => {
    const f = fakeFetch({
      "POST /login": () => new Response("<html>cloudflare</html>", { status: 403 }),
    });
    await expect(
      new BambuCloudClient("global", f.fetch).login("a@b.c", "x"),
    ).rejects.toBeInstanceOf(CloudError);
  });

  it("uses the China API host for the China region", async () => {
    const f = fakeFetch({ "POST /sendemail/code": () => jsonResponse({}) });
    await new BambuCloudClient("china", f.fetch).sendEmailCode("a@b.c");
    expect(f.calls[0]!.url).toBe("https://api.bambulab.cn/v1/user-service/user/sendemail/code");
    expect(f.calls[0]!.body).toEqual({ email: "a@b.c", type: "codeLogin" });
  });

  it("lists bound devices with the bearer token", async () => {
    const f = fakeFetch({
      "GET /v1/iot-service/api/user/bind": () =>
        jsonResponse({
          message: "success",
          devices: [
            {
              dev_id: "01P00C662003044",
              name: "My P1S",
              online: true,
              print_status: "IDLE",
              dev_model_name: "C12",
              dev_product_name: "P1S",
              dev_access_code: "abcd1234\n",
            },
            { bogus: true },
          ],
        }),
    });
    const devices = await new BambuCloudClient("global", f.fetch).listDevices("tok");
    expect(f.calls[0]!.headers.authorization).toBe("Bearer tok");
    expect(devices).toEqual([
      {
        serial: "01P00C662003044",
        name: "My P1S",
        online: true,
        model: "C12",
        productName: "P1S",
        printStatus: "IDLE",
        accessCode: "abcd1234",
      },
    ]);
  });

  it("derives the MQTT username from the JWT, falling back to preferences", async () => {
    expect(usernameFromJwt(jwt({ username: "u_42" }))).toBe("u_42");
    const f = fakeFetch({ "GET /my/preference": () => jsonResponse({ uid: 77 }) });
    expect(await new BambuCloudClient("global", f.fetch).getMqttUsername("opaque-token")).toBe(
      "u_77",
    );
  });
});
