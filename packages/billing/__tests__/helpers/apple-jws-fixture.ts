/**
 * テスト用 Apple JWS 署名チェーン生成ヘルパー (#40)
 *
 * openssl CLI を使い、テスト専用の自己署名ルート CA + leaf 証明書チェーンを生成し、
 * StoreKit 2 の signedJws (JWS, ES256 + x5c ヘッダー) 相当のトークンを署名する。
 * 本番の Apple Root CA とは無関係のテスト専用証明書であり、本番コードには一切含まれない。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

export interface AppleJwsTestChain {
  /** JWS header.x5c に入れる base64 DER 証明書配列 (leaf, root の順) */
  x5cChain: string[];
  /** ルート証明書 (PEM)。IapAdapterConfig.trustedRootCertsPem のテストに使用する */
  rootCertPem: string;
  /** leaf の秘密鍵 (PEM)。JWS 署名に使用する */
  leafPrivateKeyPem: string;
}

let cachedChain: AppleJwsTestChain | null = null;

/**
 * テスト専用の leaf/root 証明書チェーンを openssl で新規生成する (毎回別チェーン)。
 * チェーンリンク不正・ルート不一致テストなど、キャッシュ済みチェーンとは異なる
 * チェーンが必要な場合に使用する。
 */
export function generateAppleJwsTestChain(): AppleJwsTestChain {
  const dir = mkdtempSync(join(tmpdir(), "apple-jws-test-"));
  const run = (args: string[]): void => {
    execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  };

  const rootKey = join(dir, "root-key.pem");
  const rootCert = join(dir, "root-cert.pem");
  const leafKey = join(dir, "leaf-key.pem");
  const leafCsr = join(dir, "leaf-csr.pem");
  const leafCert = join(dir, "leaf-cert.pem");
  const rootDer = join(dir, "root-cert.der");
  const leafDer = join(dir, "leaf-cert.der");

  try {
    run(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", rootKey]);
    run([
      "req", "-x509", "-new", "-key", rootKey, "-days", "3650",
      "-subj", "/CN=Test Apple Root CA/O=TrancallTest", "-out", rootCert,
    ]);

    run(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", leafKey]);
    run([
      "req", "-new", "-key", leafKey,
      "-subj", "/CN=Test Apple Leaf/O=TrancallTest", "-out", leafCsr,
    ]);
    run([
      "x509", "-req", "-in", leafCsr, "-CA", rootCert, "-CAkey", rootKey,
      "-CAcreateserial", "-days", "3650", "-out", leafCert,
    ]);

    run(["x509", "-in", rootCert, "-outform", "DER", "-out", rootDer]);
    run(["x509", "-in", leafCert, "-outform", "DER", "-out", leafDer]);

    const x5cChain = [
      readFileSync(leafDer).toString("base64"),
      readFileSync(rootDer).toString("base64"),
    ];
    const rootCertPem = readFileSync(rootCert, "utf-8");
    const leafPrivateKeyPem = readFileSync(leafKey, "utf-8");

    return { x5cChain, rootCertPem, leafPrivateKeyPem };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * テスト専用の leaf/root 証明書チェーンを取得する (プロセス内でキャッシュ)。
 * 複数チェーンが必要なテスト (チェーンリンク不正・root pinning 不一致等) では
 * generateAppleJwsTestChain() を直接使うこと。
 */
export function getAppleJwsTestChain(): AppleJwsTestChain {
  cachedChain ??= generateAppleJwsTestChain();
  return cachedChain;
}

function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

/**
 * payload を Apple StoreKit 2 JWS 形式 (ES256 + x5c) で署名する。
 * chain を省略した場合は getAppleJwsTestChain() のテストチェーンを使用する。
 */
export function signAppleJws(
  payload: Record<string, unknown>,
  chain: AppleJwsTestChain = getAppleJwsTestChain(),
): string {
  return signAppleJwsRaw(payload, { alg: "ES256", x5c: chain.x5cChain }, chain.leafPrivateKeyPem);
}

/**
 * header を自由に指定して JWS を署名する (alg 不一致 / x5c 欠落等の異常系テスト用)。
 */
export function signAppleJwsRaw(
  payload: Record<string, unknown>,
  header: Record<string, unknown>,
  signingKeyPem: string,
): string {
  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: signingKeyPem,
    dsaEncoding: "ieee-p1363",
  });

  return `${signingInput}.${toBase64Url(signature)}`;
}

/**
 * x5c チェーンのリンクが壊れた JWS (leaf は正しいが issuer 証明書が無関係) を生成する。
 * チェーンリンク検証失敗のテストに使用する。
 */
export function signAppleJwsWithBrokenChain(payload: Record<string, unknown>): string {
  const chainA = getAppleJwsTestChain();
  const chainB = generateAppleJwsTestChain();
  const leaf = chainA.x5cChain[0];
  const unrelatedRoot = chainB.x5cChain[1];
  if (leaf === undefined || unrelatedRoot === undefined) {
    throw new Error("test setup: chain generation failed");
  }
  return signAppleJwsRaw(
    payload,
    { alg: "ES256", x5c: [leaf, unrelatedRoot] },
    chainA.leafPrivateKeyPem,
  );
}

/**
 * 署名済み JWS の signature 部分を改竄した文字列を返す (改竄検知テスト用)。
 */
export function tamperJwsSignature(jws: string): string {
  const parts = jws.split(".");
  const header = parts[0];
  const payload = parts[1];
  const signature = parts[2];
  if (header === undefined || payload === undefined || signature === undefined) {
    throw new Error("test setup: invalid JWS to tamper with");
  }
  const sigBuf = Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const firstByte = sigBuf[0];
  sigBuf[0] = ((firstByte ?? 0) ^ 0xff) & 0xff;
  return `${header}.${payload}.${toBase64Url(sigBuf)}`;
}
