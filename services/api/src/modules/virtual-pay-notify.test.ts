import { describe, expect, it } from "vitest";
import {
  VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES,
  decryptWechatMessageAes,
  looksLikeWechatPayApiV3,
  messagePushMsgSignature,
  messagePushSignature,
  verifyVirtualPayNotify,
  xmlLooksUnsafe
} from "./virtual-pay-notify.js";

const officialEncrypt =
  "+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04=";

describe("virtual pay notify protocol", () => {
  it("matches official message-push URL and plaintext signature fixtures", () => {
    const url = VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES.urlVerify;
    expect(messagePushSignature(url.token, url.timestamp, url.nonce)).toBe(url.signature);
    const plain = VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES.plainPost;
    expect(messagePushSignature(plain.token, plain.timestamp, plain.nonce)).toBe(plain.signature);
  });

  it("verifies URL handshake and returns echostr", () => {
    const url = VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES.urlVerify;
    const result = verifyVirtualPayNotify(
      {
        httpMethod: "GET",
        queryStringParameters: {
          signature: url.signature,
          timestamp: url.timestamp,
          nonce: url.nonce,
          echostr: url.echostr
        }
      },
      { token: url.token }
    );
    expect(result).toEqual({ kind: "url-verify", echostr: url.echostr });
  });

  it("verifies a plaintext xpay goods deliver fixture and does not grant VIP", () => {
    const plain = VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES.plainPost;
    const result = verifyVirtualPayNotify(
      {
        httpMethod: "POST",
        queryStringParameters: {
          signature: plain.signature,
          timestamp: plain.timestamp,
          nonce: plain.nonce
        },
        body: JSON.stringify({
          ToUserName: "gh_fixture",
          FromUserName: "official_openid_fixture",
          CreateTime: 1714037059,
          MsgType: "event",
          Event: "xpay_goods_deliver_notify",
          Env: 1
        })
      },
      { token: plain.token }
    );
    expect(result).toMatchObject({
      ok: true,
      ErrCode: 0,
      eventType: "xpay_goods_deliver_notify",
      vipGranted: false,
      protocol: "virtual-pay-message-push"
    });
  });

  it("rejects forged signatures and APIv3 callbacks", () => {
    const plain = VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES.plainPost;
    const forged = verifyVirtualPayNotify(
      {
        httpMethod: "POST",
        queryStringParameters: {
          signature: "0".repeat(40),
          timestamp: plain.timestamp,
          nonce: plain.nonce
        },
        body: JSON.stringify({ Event: "xpay_goods_deliver_notify" })
      },
      { token: plain.token }
    );
    expect(forged).toMatchObject({ ok: false, reason: "SIGNATURE_INVALID", vipGranted: false });

    expect(
      looksLikeWechatPayApiV3({
        rawBody: JSON.stringify({
          event_type: "TRANSACTION.SUCCESS",
          resource_type: "encrypt-resource",
          resource: { algorithm: "AEAD_AES_256_GCM", ciphertext: "not-used" }
        })
      })
    ).toBe(true);
    const apiV3 = verifyVirtualPayNotify({
      headers: { "Wechatpay-Signature": "fake" },
      body: JSON.stringify({
        event_type: "TRANSACTION.SUCCESS",
        resource: { ciphertext: "not-used" }
      })
    });
    expect(apiV3).toMatchObject({ ok: false, reason: "APIV3_REJECTED", vipGranted: false });
  });

  it("rejects XML external entities before parse", () => {
    expect(
      xmlLooksUnsafe('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://127.0.0.1/x">]><xml><Event>&xxe;</Event></xml>')
    ).toBe(true);
    const plain = VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES.plainPost;
    const result = verifyVirtualPayNotify(
      {
        httpMethod: "POST",
        queryStringParameters: {
          signature: plain.signature,
          timestamp: plain.timestamp,
          nonce: plain.nonce
        },
        body: '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://127.0.0.1/x">]><xml><Event>xpay_goods_deliver_notify</Event></xml>'
      },
      { token: plain.token }
    );
    expect(result).toMatchObject({ ok: false, reason: "XML_EXTERNAL_ENTITY_DENIED", vipGranted: false });
  });

  it("decrypts the official safe-mode fixture after msg_signature check", () => {
    const token = "AAAAA";
    const timestamp = "1714112445";
    const nonce = "415670741";
    const expected = "046e02f8204d34f8ba5fa3b1db94908f3df2e9b3";
    expect(messagePushMsgSignature(token, timestamp, nonce, officialEncrypt)).toBe(expected);
    const decrypted = decryptWechatMessageAes({
      encrypt: officialEncrypt,
      encodingAesKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      expectedAppId: "wxba5fad812f8e6fb9"
    });
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) return;
    const payload = JSON.parse(decrypted.plain) as { Event: string };
    expect(payload.Event).toBe("debug_demo");
    const result = verifyVirtualPayNotify(
      {
        httpMethod: "POST",
        queryStringParameters: {
          signature: "ignored-for-safe-mode",
          timestamp,
          nonce,
          encrypt_type: "aes",
          msg_signature: expected
        },
        body: JSON.stringify({ ToUserName: "gh_97417a04a28d", Encrypt: officialEncrypt })
      },
      {
        token,
        encodingAesKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        appId: "wxba5fad812f8e6fb9"
      }
    );
    expect(result).toMatchObject({
      ok: true,
      eventType: "debug_demo",
      vipGranted: false
    });
  });
});
