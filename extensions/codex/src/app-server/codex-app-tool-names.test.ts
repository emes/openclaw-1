import { describe, expect, it } from "vitest";
import type { CodexAppServerTool } from "./app-tool-inventory.js";
import {
  resolveCodexAppModelToolNames,
  resolveCodexAppModelToolNamesByConnector,
  sanitizeCodexConnectorName,
} from "./codex-app-tool-names.js";

function tool(
  name: string,
  connectorId: string,
  connectorName?: string,
  modelVisible?: boolean,
): CodexAppServerTool {
  return {
    name,
    connectorId,
    ...(connectorName ? { connectorName } : {}),
    ...(modelVisible === false ? { modelVisible } : {}),
  };
}

describe("sanitizeCodexConnectorName", () => {
  it("matches Codex sanitize_name", () => {
    expect(sanitizeCodexConnectorName("Delta Tools")).toBe("delta_tools");
    expect(sanitizeCodexConnectorName("  Gamma-Mail!  ")).toBe("gamma_mail");
    expect(sanitizeCodexConnectorName("***")).toBe("app");
  });
});

describe("resolveCodexAppModelToolNames", () => {
  it("names connector-prefixed tools the way Codex exposes them to the model", () => {
    const delta = tool("delta_tools.list_things", "asdk_app_delta", "Delta Tools");
    expect(resolveCodexAppModelToolNames([delta]).get(delta)).toBe(
      "mcp__codex_apps__delta_tools_list_things",
    );
  });

  it("strips the connector id prefix when the name prefix is absent", () => {
    const byId = tool("connector_gamma.send", "connector_gamma", "Gamma Mail");
    expect(resolveCodexAppModelToolNames([byId]).get(byId)).toBe(
      "mcp__codex_apps__gamma_mail_send",
    );
  });

  it("keeps an unprefixed raw name and appends it to the namespace", () => {
    // Mirrors the codex-rs fixture: raw `capture_file_upload` under connector `Gmail`
    // keeps its callable name, and the namespace becomes `codex_apps__gmail`.
    const gmail = tool("capture_file_upload", "connector_gmail", "Gmail");
    expect(resolveCodexAppModelToolNames([gmail]).get(gmail)).toBe(
      "mcp__codex_apps__gmailcapture_file_upload",
    );
  });

  it("hashes colliding namespaces and colliding tool names", () => {
    const first = tool("gamma.list", "asdk_app_one", "Gamma");
    const second = tool("gamma.list", "asdk_app_two", "Gamma");
    const names = resolveCodexAppModelToolNames([first, second]);
    const firstName = names.get(first)!;
    const secondName = names.get(second)!;
    expect(firstName).not.toBe(secondName);
    expect(firstName).toMatch(/^mcp__codex_apps__gamma_[0-9a-f]{12}_list$/);
    expect(secondName).toMatch(/^mcp__codex_apps__gamma_[0-9a-f]{12}_list$/);
  });

  it("fits over-long names into 128 bytes with a hash suffix", () => {
    const long = tool(`delta.${"x".repeat(150)}`, "asdk_app_delta", "Delta");
    const name = resolveCodexAppModelToolNames([long]).get(long)!;
    expect(name.length + 2).toBeLessThanOrEqual(128);
    expect(name).toMatch(/_[0-9a-f]{12}$/);
  });

  it("groups model names by connector id over the whole inventory", () => {
    const grouped = resolveCodexAppModelToolNamesByConnector(
      new Map([
        ["asdk_app_delta", [tool("delta.list_things", "asdk_app_delta", "Delta")]],
        [
          "asdk_app_gamma",
          [
            tool("gamma.list_items", "asdk_app_gamma", "Gamma"),
            tool("gamma.send_item", "asdk_app_gamma", "Gamma"),
          ],
        ],
      ]),
    );
    expect([...grouped]).toEqual([
      [
        "asdk_app_delta",
        {
          namespaces: ["mcp__codex_apps__delta"],
          modelToolNames: ["mcp__codex_apps__delta_list_things"],
        },
      ],
      [
        "asdk_app_gamma",
        {
          namespaces: ["mcp__codex_apps__gamma"],
          modelToolNames: ["mcp__codex_apps__gamma_list_items", "mcp__codex_apps__gamma_send_item"],
        },
      ],
    ]);
  });

  it("keeps hidden tools out of the model names but inside collision hashing", () => {
    // Codex normalizes every listed tool before it filters model visibility, so a
    // hidden tool still forces the hash suffix onto the visible tool it collides with.
    const visible = tool("gamma.list", "asdk_app_gamma", "Gamma");
    const hidden = tool("gamma.list", "asdk_app_gamma_widgets", "Gamma", false);
    const grouped = resolveCodexAppModelToolNamesByConnector(
      new Map([
        ["asdk_app_gamma", [visible]],
        ["asdk_app_gamma_widgets", [hidden]],
      ]),
    );
    const gamma = grouped.get("asdk_app_gamma")!;
    expect(gamma.modelToolNames).toHaveLength(1);
    expect(gamma.modelToolNames[0]).not.toBe("mcp__codex_apps__gamma_list");
    expect(gamma.modelToolNames[0]).toBe(
      resolveCodexAppModelToolNames([visible, hidden]).get(visible),
    );
    const widgets = grouped.get("asdk_app_gamma_widgets")!;
    expect(widgets.modelToolNames).toEqual([]);
    expect(widgets.namespaces).toHaveLength(1);
    expect(widgets.namespaces[0]).toMatch(/^mcp__codex_apps__gamma/);
    expect(widgets.namespaces[0]).not.toBe(gamma.namespaces[0]);
  });
});
