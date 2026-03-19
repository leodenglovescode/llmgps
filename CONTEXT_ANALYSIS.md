# Context Window Analysis: Current vs. Optimized Debate Process

## 1. Context Capacity by Model Type

| Model Type | Context Window | Max Safe Conversation | Debate Mode Safe? | Research Use Case |
|---|---|---|---|---|
| **4K Models** (GPT-3.5) | 4,096 | 2-3 exchanges | ❌ NO | ❌ Not viable |
| **8K Models** (GPT-4) | 8,192 | 4-5 exchanges | ⚠️ RISKY | ❌ Very limited |
| **32K Models** (GPT-4-32K, Claude-2) | 32,000 | 15-20 exchanges | ⚠️ RISKY | ⚠️ Borderline |
| **128K Models** (GPT-4-Turbo, Claude-3-Opus) | 128,000 | 50-60 exchanges | ✅ SAFE | ✅ Good |
| **192K Models** (Gemini-2-Flash) | 192,000 | 75-90 exchanges | ✅ SAFE | ✅ Very Good |
| **1M Models** (Claude-3.5-Sonnet, Grok-2) | 1,000,000 | 400+ exchanges | ✅ EXCELLENT | ✅ Ideal |

---

## 2. Current Problem: Unbounded Context Growth

### Scenario: 5 Responders + Debate Mode with Different Conversation Lengths

#### Short Conversation (10 exchanges ≈ 2K tokens)

```
Opinion Round:  5 models × 2K = 10K tokens
Debate Round:   5 models × (2K hist + 500 opinion + 2K others) = 24K tokens
Synthesis:      1 model × (2K hist + 2.5K opinions + 2.5K debates) = 7.4K tokens
─────────────────────────────────────────────────────
TOTAL:          ~41.4K tokens consumed
```

**Model Impact:**
- ✅ 128K model: Uses 32% of capacity
- ✅ 192K model: Uses 22% of capacity
- ✅ 1M model: Uses 4% of capacity

---

#### Medium Conversation (50 exchanges ≈ 10K tokens)

```
Opinion Round:  5 models × 10K = 50K tokens
Debate Round:   5 models × (10K hist + 2.5K opinions + 10K others) = 112.5K tokens
Synthesis:      1 model × (10K hist + 12.5K opinions + 12.5K debates) = 35K tokens
─────────────────────────────────────────────────────
TOTAL:          ~197.5K tokens consumed
```

**Model Impact:**
- ❌ 128K model: EXCEEDS capacity (154%)
- ⚠️ 192K model: Uses 103% (OVERLOAD)
- ✅ 1M model: Uses 20% of capacity

---

#### Large Conversation (100 exchanges ≈ 20K tokens)

```
Opinion Round:  5 models × 20K = 100K tokens
Debate Round:   5 models × (20K + 5K opinions + 20K others) = 225K tokens
Synthesis:      1 model × (20K + 25K opinions + 25K debates) = 70K tokens
─────────────────────────────────────────────────────
TOTAL:          ~395K tokens consumed
```

**Model Impact:**
- ❌ 128K model: EXCEEDS capacity (309%)
- ❌ 192K model: EXCEEDS capacity (206%)
- ✅ 1m model: Uses 40% of capacity (BUT still expensive)

---

## 3. Where Context Gets Out of Hand

### The Synthesis Bottleneck 🚨

The **synthesis step is where context explodes**:

```typescript
// Current synthesis receives:
buildSynthesisMessage(
  cleanMessages,      // Full original conversation
  finalOpinions       // All debate responses from all models
)
```

**Why it grows unbounded:**
- Each responder's debate response averages 500-1000 tokens
- 5 responders × 2 rounds × 750 tokens average = 7.5K just for opinions
- Large conversations can easily hit 20-30K tokens in synthesis alone
- Synthesizer then needs to analyze and combine all of this

### The Debate Round Amplification 🚨

Each model in debate round receives:
- Original conversation history (unchanged)
- Its own previous opinion (500 tokens)
- **All other models' opinions** (additive with each new responder)

With 5 responders, each one gets 4 other opinions added. This is:
- Linear scaling with # of responders
- Not pruned or filtered
- Could exceed context window mid-debate

---

## 4. Recommended Solutions (Priority Order)

### ⭐ SOLUTION 1: Intelligent Context Truncation (HIGH IMPACT)

**Problem addressed:** Uncontrolled conversation history growth

**Implementation:**
```typescript
// In runGpsWorkflowStreaming() around line 750
const MAX_HISTORY_TOKENS = 4000; // Adjustable per model tier

function truncateHistoryToFitContext(
  messages: ChatMessage[],
  maxTokens: number,
  modelCapacity: number
) {
  // Keep last N messages (most recent are most relevant)
  // Remove oldest messages first
  // Estimate tokens using: message.role.length + message.content.length * 1.3
  
  let totalTokens = 0;
  const result = [];
  
  // Iterate from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = msg.role.length + (msg.content.length * 1.3);
    if (totalTokens + tokens <= maxTokens) {
      result.unshift(msg); // Add to front
      totalTokens += tokens;
    } else if (result.length === 0) {
      // Always keep at least the most recent message
      result.unshift(msg);
      break;
    } else {
      break;
    }
  }
  
  // If truncated, add a summary message at the beginning
  if (result.length < messages.length) {
    result.unshift({
      role: "system",
      content: `[Previous conversation truncated. ${messages.length - result.length} older exchanges omitted for context window.]`
    });
  }
  
  return result;
}
```

**Cost:** LOW - Simple token counting
**Impact:** Prevents context overflow for long conversations
**For research:** Allows multi-session continuity without explosion

---

### ⭐ SOLUTION 2: Opinion Summarization (MEDIUM IMPACT)

**Problem addressed:** Debate round receiving all full opinions

**Implementation:**
```typescript
// Before debate round, summarize opinions
async function summarizeOpinion(
  fullOpinion: string,
  maxTokens: number = 300
): Promise<string> {
  // Use a small, fast model (Llama2, etc.)
  // Prompt: "Summarize this response in key bullet points, max X tokens"
  
  const summary = await summarizeModel.generateText({
    prompt: `Summarize this response in key points (max ${maxTokens} tokens):\n\n${fullOpinion}`,
    maxTokens: maxTokens,
  });
  
  return summary;
}

// In debate round (~line 871), replace:
const otherOpinionsText = initialOpinions
  .filter((o) => o.modelId !== model.modelId)
  .map((o) => `[${o.label}]:\n${o.content}`)  // ❌ Full text
  .join('\n\n');

// With:
const otherOpionsSummaries = await Promise.all(
  initialOpinions
    .filter((o) => o.modelId !== model.modelId)
    .map(async (o) => `[${o.label}]:\n${await summarizeOpinion(o.content, 200)}`)
);
const otherOpinionsText = otherOpionsSummaries.join('\n\n');
```

**Cost:** MEDIUM - Adds extra API calls (5 summaries per debate round)
**Impact:** Reduces debate context by 50-70%
**For research:** Keeps essential points without full text

---

### ⭐ SOLUTION 3: Adaptive Responder Count (LOW COST)

**Problem addressed:** 5 responders = exponential context growth

**Implementation:**
```typescript
// In UI or routing logic, check conversation length first
function getAdaptiveResponderCount(
  conversationLengthTokens: number,
  responderModels: Model[]
): Model[] {
  if (conversationLengthTokens > 15000) {
    // Long conversation: use 2-3 models
    return responderModels.slice(0, 2);
  } else if (conversationLengthTokens > 8000) {
    // Medium: use 3-4 models
    return responderModels.slice(0, 3);
  } else {
    // Short: use all
    return responderModels;
  }
}
```

**Cost:** FREE - Just logic change
**Impact:** Prevents exponential scaling
**For research:** More focused debates on large topics

---

### ⭐ SOLUTION 4: Two-Phase Synthesis (MEDIUM IMPACT)

**Problem addressed:** Synthesis receives all opinions + debates at once

**Implementation:**
```typescript
// Phase 1: Intermediate synthesis
// Combine opinions into summary per debate topic
const phaseSynthesis = await sendModelMessage(
  smallSynthesizer,  // Cheaper model
  apiKey,
  [{
    role: "user",
    content: `Summarize key disagreements and agreements:\n\n${opinionsBlock}`
  }]
);

// Phase 2: Final synthesis
// One model synthesizes using original history + intermediate summary
const finalSynthesis = await sendModelMessage(
  mainSynthesizer,
  apiKey,
  [
    ...truncatedHistory,
    {
      role: "assistant",
      content: phaseSynthesis  // Condensed opinions
    },
    {
      role: "user",
      content: "Given the above, what is the final answer?"
    }
  ]
);
```

**Cost:** MEDIUM - Extra API call for first synthesis
**Impact:** Reduces final synthesis context by 60-80%
**For research:** Better separation of concerns

---

### ⭐ SOLUTION 5: Model-Aware Context Limiting (HIGH IMPACT)

**Problem addressed:** Using same context size for 4K and 1M models

**Implementation:**
```typescript
// Get model capacity from provider API or config
const modelContextCapacity = {
  "gpt-3.5-turbo": 4096,
  "gpt-4": 8192,
  "gpt-4-turbo": 128000,
  "claude-3-opus": 128000,
  "claude-3.5-sonnet": 200000,
  "gpt-1m": 1000000,
  // ... etc
};

// Reserve 25% for output
const safeContext = Math.floor(modelContextCapacity[modelId] * 0.75);

// Apply truncation based on this model's actual capacity
const truncatedMessages = truncateHistoryToFitContext(
  messages,
  safeContext,
  modelCapacity[modelId]
);
```

**Cost:** FREE - Just lookup table
**Impact:** Prevents silent failures on smaller models
**For research:** Automatic scaling to model capabilities

---

## 5. Recommended Implementation Plan

### Phase 1: Immediate (Week 1)
1. **Add context token estimation** - Count tokens in each message
2. **Implement truncation** - Solution #1 (Intelligent Context Truncation)
3. **Add logging** - Track context usage per request
   ```typescript
   logger.info(`Context usage: history=${historyTokens}, opinions=${opinionTokens}, debate=${debateTokens}, synthesis=${synthesisTokens}, total=${totalTokens}`);
   ```

### Phase 2: Enhanced (Week 2-3)
4. **Add model-aware limiting** - Solution #5
5. **Implement adaptive responder count** - Solution #3
6. **Add UI warnings** - Alert user if conversation exceeds safe size

### Phase 3: Advanced (Week 4+)
7. **Opinion summarization** - Solution #2 (requires additional model)
8. **Two-phase synthesis** - Solution #4
9. **Conversation compression** - Save summaries of old conversations for recall

---

## 6. Research Use Case: Optimized Flow

### For large research projects with debate mode:

```
User's 500-exchange research conversation
                    ↓
[Truncate to last 50 exchanges (~10K tokens)]
                    ↓
[Select 2-3 responders based on conversation size]
                    ↓
[Opinion Round: 2 models × 10K = 20K tokens]
                    ↓
[Summarize opinions to 200 tokens each]
                    ↓
[Debate Round: 2 models × (10K + 400 summary + prompt) = 20.8K tokens]
                    ↓
[Intermediate synthesis of disagreements]
                    ↓
[Final synthesis: 1 model × (10K history + 2K summary) = 12K tokens]
                    ↓
TOTAL: ~52.8K tokens (vs 197K with current approach!)
✅ Safe for 128K models
✅ 73% cost reduction
```

---

## 7. Expected Improvements

| Metric | Current | After All Solutions |
|--------|---------|---|
| Max safe conversation size | 15-20 exchanges | 100+ exchanges |
| Context used per large debate | ~200K tokens | ~50K tokens |
| Responder scaling | Exponential ❌ | Linear ✅ |
| Synthesis context | Unbounded | Controlled ✅ |
| 4K model support | ❌ None | ⚠️ Limited (for short convos) |
| 128K model safety | ⚠️ Risky above 50 exchanges | ✅ Safe up to 100+ |
| Cost efficiency | Poor | 60-75% improvement |

---

## 8. Implementation Checklist

- [ ] Add token counter utility function
- [ ] Implement `truncateHistoryToFitContext()` in `src/lib/gps.ts`
- [ ] Add model capacity lookup table
- [ ] Update `runGpsWorkflowStreaming()` to use truncation
- [ ] Add context logging to debug panel
- [ ] Test with 50-exchange conversation
- [ ] Test with 100-exchange conversation
- [ ] Add UI warning for large conversations
- [ ] Document context limits in README
- [ ] (Optional) Add opinion summarization
- [ ] (Optional) Implement two-phase synthesis

