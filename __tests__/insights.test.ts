import { afterEach, describe, expect, it, vi } from "vitest";
import { runInsightAgent, suggestionPatch, validateProposal } from "@/lib/insights";

const completion = (message: object, model = "openai/gpt-6-luna") =>
  new Response(JSON.stringify({ model, choices: [{ message }] }));
const toolCall = (id: string, name: string, args: object) => ({
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const sentBodies = (mock: ReturnType<typeof vi.spyOn>) =>
  mock.mock.calls.map((c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string));

afterEach(() => vi.restoreAllMocks());

describe("insight agent loop", () => {
  it("runs a tool, feeds the result back, then returns the answer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(completion(toolCall("c1", "list_campaigns", {}), "google/gemini-3.8-flash"))
      .mockResolvedValueOnce(completion({ content: "  GUIDE drives 70% of DMs.  " }));
    const runTool = vi.fn().mockResolvedValue([{ id: "a1", name: "Guide" }]);

    const result = await runInsightAgent("sk-test", "overview", runTool);

    expect(result).toEqual({ text: "GUIDE drives 70% of DMs.", model: "openai/gpt-6-luna", toolsUsed: ["list_campaigns"] });
    expect(runTool).toHaveBeenCalledWith("list_campaigns", {});
    const second = sentBodies(fetchMock)[1];
    expect(second.messages.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] });
    expect(second.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: '[{"id":"a1","name":"Guide"}]' });
  });

  it("returns tool errors to the model instead of failing the run", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(completion(toolCall("c1", "get_campaign_activity", { campaignId: "x" })))
      .mockResolvedValueOnce(completion({ content: "Done." }));
    await runInsightAgent("sk-test", "overview", vi.fn().mockRejectedValue(new Error("db down")));
    expect(sentBodies(fetchMock)[1].messages.at(-1).content).toBe('{"error":"db down"}');
  });

  it("forces a final answer after the step limit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      completion({ ...toolCall("c", "list_campaigns", {}), content: "Final." }),
    );
    const result = await runInsightAgent("sk-test", "overview", vi.fn().mockResolvedValue([]));
    const bodies = sentBodies(fetchMock);
    expect(bodies).toHaveLength(6);
    expect(bodies.at(-1).tool_choice).toBe("none");
    expect(result.text).toBe("Final.");
  });

  it("rejects an empty answer and maps OpenRouter errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(completion({ content: null }));
    await expect(runInsightAgent("k", "o", vi.fn())).rejects.toThrow("empty insight");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "Course waitlist failed 58 of" }, finish_reason: "length" }] })),
    );
    await expect(runInsightAgent("k", "o", vi.fn())).rejects.toThrow("cut off");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 402 }));
    await expect(runInsightAgent("k", "o", vi.fn())).rejects.toThrow("out of credits");
  });
});

describe("proposals", () => {
  const campaign = { dmMessage: "Hi {username}, here: https://x.co/a", keywords: ["guide"], matchAnyWord: false, isActive: true };

  it("keeps links and placeholders in a new DM", () => {
    expect(validateProposal(campaign, "dm_message", "Hey! Grab it")).toEqual({ error: "Keep these in the new DM: {username} https://x.co/a" });
    expect(validateProposal(campaign, "dm_message", "Hey {username}! https://x.co/a")).toEqual({ value: "Hey {username}! https://x.co/a" });
  });

  it("adds only new keywords within the limit of 10", () => {
    expect(validateProposal(campaign, "add_keywords", "GUIDE, pdf, pdf")).toEqual({ value: '["pdf"]' });
    expect(validateProposal(campaign, "add_keywords", "Guide")).toEqual({ error: "No new keywords to add." });
    expect(validateProposal(campaign, "add_keywords", "a,b,c,d,e,f,g,h,i,j")).toEqual({ error: "A campaign can have at most 10 keywords." });
    expect(validateProposal({ ...campaign, matchAnyWord: true }, "add_keywords", "pdf")).toHaveProperty("error");
  });

  it("builds the campaign patch against current keywords", () => {
    expect(suggestionPatch("add_keywords", '["pdf","link"]', ["guide", "PDF"])).toEqual({ keywords: ["guide", "PDF", "link"] });
    expect(suggestionPatch("pause", "", [])).toEqual({ isActive: false });
    expect(validateProposal({ ...campaign, isActive: false }, "pause", "")).toHaveProperty("error");
  });
});
