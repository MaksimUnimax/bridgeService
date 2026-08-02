(() => {
  "use strict";
  const confirmedLocalWritingBlockCopyButtons = new WeakSet();
  function turnSections() {
    const fn = globalThis.BB2CaptureEnvironment?.turnSections;
    return typeof fn === "function" ? fn() : [];
  }
  // BEGIN EXACT V1.8.37.9 WRITING-BLOCK CAPTURE
  function safeText(node) {
    return String(node?.innerText || node?.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
  }
  function legacyWritingBlockElement(section) {
    return section?.querySelector?.('[data-writing-block], [data-writing-block-id], #code-block-viewer') || null;
  }

  function isCurrentWritingBlockEditButton(button) {
    const snapshot = buttonSnapshot(button);
    return snapshot.testid === "writing-block-header-magic-edit-button" ||
      /(?:^|\s)(?:редактировать|edit)(?:\s|$)/u.test(buttonToken(snapshot));
  }

  function isCurrentWritingBlockLocalCopyButton(button) {
    const snapshot = buttonSnapshot(button);
    // Never accept ChatGPT's generic assistant-turn action as the local
    // writing-block Copy control.
    if (snapshot.testid === "copy-turn-action-button" ||
        /копировать\s+ответ|copy\s+response/u.test(buttonToken(snapshot))) {
      return false;
    }
    return snapshot.aria === "Копировать" ||
      /(?:^|\s)(?:копировать|copy)(?:\s|$)/u.test(buttonToken(snapshot));
  }

  function cleanLocalWritingBlockText(root) {
    if (!(root instanceof Element)) return "";
    const clone = root.cloneNode(true);
    // Do not remove [aria-live]. Current ChatGPT may place the writing-block
    // body inside that element after completion. Remove controls only.
    clone.querySelectorAll("button, [role=button], svg, script, style").forEach((node) => node.remove());
    return String(clone.innerText || clone.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function currentWritingBlockBinding(section) {
    if (!(section instanceof Element)) return null;
    const buttons = Array.from(section.querySelectorAll("button"));
    const edits = buttons.filter(isCurrentWritingBlockEditButton);
    const copies = buttons.filter(isCurrentWritingBlockLocalCopyButton);

    for (const editButton of edits) {
      for (const copyButton of copies) {
        let root = copyButton.parentElement;
        while (root && root !== section) {
          if (root.contains(editButton) && root.contains(copyButton)) {
            const body = cleanLocalWritingBlockText(root);
            if (body.length > 0) {
              return {
                root,
                edit_button: editButton,
                copy_button: copyButton,
                source: "current_local_toolbar"
              };
            }
          }
          root = root.parentElement;
        }
      }
    }
    return null;
  }

  function resolveWritingBlockBinding(section) {
    const legacyRoot = legacyWritingBlockElement(section);
    if (legacyRoot instanceof Element) {
      const localCopy = Array.from(legacyRoot.querySelectorAll("button"))
        .find(isCurrentWritingBlockLocalCopyButton) || null;
      return {
        root: legacyRoot,
        edit_button: null,
        copy_button: localCopy,
        source: "legacy_explicit_root"
      };
    }
    return currentWritingBlockBinding(section);
  }

  function writingBlockElement(section) {
    return resolveWritingBlockBinding(section)?.root || null;
  }

  function sectionWritingBlockText(section, binding = null) {
    const resolved = binding || resolveWritingBlockBinding(section);
    if (!resolved?.root) return "";
    if (resolved.source === "current_local_toolbar") {
      return cleanLocalWritingBlockText(resolved.root);
    }
    // Preserve the proven legacy payload adapter verbatim for old explicit
    // writing-block roots.
    return (resolved.root.innerText || resolved.root.textContent || "")
      .replace(/^Редактировать\s*/u, "")
      .replace(/\s*Копировать(?:\s+ответ)?\s*$/u, "")
      .replace(/\s*Развернуть\s*$/u, "");
  }

  function writingBlockStructuralId(section) {
    const binding = resolveWritingBlockBinding(section);
    const block = binding?.root;
    if (!block) return "";
    return block.getAttribute("data-writing-block-id") ||
      block.getAttribute("data-writing-block") ||
      block.id ||
      binding?.source ||
      section.getAttribute("data-turn-id") ||
      "writing-block";
  }

  function writingBlockStructuralSignature(anchorTurnId, assistant, blockId, copy) {
    const controls = (copy?.buttons || []).map((button) => [
      button.tag || "", button.testid || "", button.aria || "", button.title || "", button.svg || "", button.enabled === true ? "1" : "0"
    ].join(":"));
    return [
      anchorTurnId || "",
      assistant?.getAttribute("data-turn-id") || "",
      blockId || "",
      copy?.writing_block === true ? "writing-block" : "no-writing-block",
      copy?.ready === true ? "copy-ready" : "copy-pending",
      copy?.mode || "",
      controls.join("|")
    ].join("||");
  }

  function buttonSnapshot(button) {
    const svgUse = button.querySelector("svg use");
    return {
      tag: button.tagName.toLowerCase(),
      testid: button.getAttribute("data-testid") || "",
      aria: button.getAttribute("aria-label") || "",
      title: button.getAttribute("title") || "",
      text: safeText(button),
      svg: svgUse?.getAttribute("href") || svgUse?.getAttribute("xlink:href") || "",
      enabled: !(button instanceof HTMLButtonElement && button.disabled) &&
        button.getAttribute("aria-disabled") !== "true"
    };
  }

  function buttonToken(snapshot) {
    return [snapshot.testid, snapshot.aria, snapshot.title, snapshot.text]
      .join(" ")
      .toLowerCase();
  }

  function detectCopyReadiness(section) {
    const buttons = Array.from(section?.querySelectorAll?.("button") || [])
      .map((button) => ({ button, snapshot: buttonSnapshot(button) }));
    const binding = resolveWritingBlockBinding(section);
    const localCopySnapshot = binding?.copy_button ? buttonSnapshot(binding.copy_button) : null;

    if (binding?.source === "current_local_toolbar" && localCopySnapshot) {
      return {
        ready: localCopySnapshot.enabled === true,
        mode: localCopySnapshot.enabled ? "current_writing_block_local_copy" : "current_writing_block_copy_disabled",
        writing_block: true,
        buttons: buttons.map((entry) => entry.snapshot)
      };
    }

    const allSemanticCopy = buttons.find((entry) => {
      const token = buttonToken(entry.snapshot);
      return entry.snapshot.testid === "copy-turn-action-button" ||
        token.includes("copy") ||
        token.includes("копир");
    });
    const allSpriteCopy = buttons.find((entry) => String(entry.snapshot.svg).includes("#ce3544"));
    const writingBlock = Boolean(binding?.root);

    if ((allSemanticCopy && !allSemanticCopy.snapshot.enabled) ||
        (allSpriteCopy && !allSpriteCopy.snapshot.enabled)) {
      return {
        ready: false,
        mode: "copy_control_disabled",
        writing_block: writingBlock,
        buttons: buttons.map((entry) => entry.snapshot)
      };
    }

    if (allSemanticCopy && allSemanticCopy.snapshot.enabled) {
      return {
        ready: true,
        mode: "semantic_copy_button",
        writing_block: writingBlock,
        buttons: buttons.map((entry) => entry.snapshot)
      };
    }

    if (allSpriteCopy && allSpriteCopy.snapshot.enabled) {
      return {
        ready: true,
        mode: "copy_svg_sprite",
        writing_block: writingBlock,
        buttons: buttons.map((entry) => entry.snapshot)
      };
    }

    return {
      ready: false,
      mode: buttons.length ? "copy_control_not_ready" : "no_controls_yet",
      writing_block: writingBlock,
      buttons: buttons.map((entry) => entry.snapshot)
    };
  }

  function confirmLocalWritingBlockCopyAndExtract(section) {
    const binding = resolveWritingBlockBinding(section);
    const text = sectionWritingBlockText(section, binding);
    const bytes = text ? new TextEncoder().encode(text).byteLength : 0;
    if (!text) {
      return { ok: false, error: "WRITING_BLOCK_LOCAL_BODY_UNAVAILABLE", text: "", bytes: 0 };
    }
    // The local Copy click verifies that the selected toolbar belongs to the
    // same local writing block. It never reads the system clipboard.
    if (binding?.source === "current_local_toolbar" && binding.copy_button instanceof HTMLElement) {
      const snapshot = buttonSnapshot(binding.copy_button);
      if (snapshot.enabled !== true) {
        return { ok: false, error: "WRITING_BLOCK_COPY_CONTROL_UNAVAILABLE", text: "", bytes: 0 };
      }
      try {
        if (!confirmedLocalWritingBlockCopyButtons.has(binding.copy_button)) {
          binding.copy_button.click();
          confirmedLocalWritingBlockCopyButtons.add(binding.copy_button);
        }
      } catch (error) {
        return { ok: false, error: `WRITING_BLOCK_COPY_CLICK_FAILED:${String(error?.message || error || "unknown")}`, text: "", bytes: 0 };
      }
    }
    return { ok: true, text, bytes, source: binding?.source || "legacy_explicit_root" };
  }
  function assistantCandidateAfterAnchor(anchorTurnId, expectedAssistantTurnId = null) {
    const sections = turnSections();
    const index = sections.findIndex((section) => section.getAttribute("data-turn-id") === anchorTurnId);
    if (index < 0) return { missing_anchor: true };

    // Copy-payload recovery is intentionally different from ordinary prompt
    // polling. It is permitted only when the worker supplied the precise
    // assistant turn captured before the paused Copy attempt. User turns that
    // appeared after the original anchor are evidence for the journal, not a
    // new anchor and not a new manual-interruption decision.
    if (expectedAssistantTurnId) {
      const interveningUserTurnIds = [];
      let expectedAssistant = null;
      for (let i = index + 1; i < sections.length; i += 1) {
        const section = sections[i];
        const turnType = section.getAttribute("data-turn");
        const turnId = section.getAttribute("data-turn-id") || "";
        if (turnType === "user" && turnId) interveningUserTurnIds.push(turnId);
        if (turnType === "assistant" && turnId === expectedAssistantTurnId) {
          expectedAssistant = section;
          break;
        }
      }
      if (!expectedAssistant) {
        return {
          waiting: true,
          expected_assistant_turn_id: expectedAssistantTurnId,
          intervening_user_turn_ids: interveningUserTurnIds,
          intervening_user_turn_count: interveningUserTurnIds.length
        };
      }

      const copy = detectCopyReadiness(expectedAssistant);
      const structuralBlockId = writingBlockStructuralId(expectedAssistant);
      const promptText = copy.writing_block ? sectionWritingBlockText(expectedAssistant) : "";
      const payloadExtracted = copy.writing_block === true && typeof promptText === "string" && promptText.length > 0;
      const payloadBytes = payloadExtracted ? new TextEncoder().encode(promptText).byteLength : 0;
      const structuralSignature = writingBlockStructuralSignature(anchorTurnId, expectedAssistant, structuralBlockId, copy);
      return {
        anchor_turn_id: anchorTurnId,
        assistant_turn_id: expectedAssistantTurnId,
        expected_assistant_turn_id: expectedAssistantTurnId,
        // Safe diagnostics only: turn IDs and count, no user text.
        intervening_user_turn_ids: interveningUserTurnIds,
        intervening_user_turn_count: interveningUserTurnIds.length,
        prompt_text: promptText,
        payload_extracted: payloadExtracted,
        payload_bytes: payloadBytes,
        payload_extraction_error: payloadExtracted ? "" : (copy.writing_block ? "writing_block_body_not_available" : "writing_block_missing"),
        copy_ready: copy.ready,
        copy_mode: copy.mode,
        writing_block: copy.writing_block,
        prompt_form_reason: copy.writing_block ? "writing_block_present" : "writing_block_missing",
        writing_block_id: structuralBlockId,
        button_snapshot: copy.buttons,
        structural_signature: structuralSignature
      };
    }

    const assistants = [];
    for (let i = index + 1; i < sections.length; i += 1) {
      const section = sections[i];
      const turnType = section.getAttribute("data-turn");
      if (turnType === "user") {
        return {
          manual_interruption: true,
          next_user_turn_id: section.getAttribute("data-turn-id"),
          manual_turn_index_after_anchor: i - index
        };
      }
      if (turnType === "assistant") assistants.push(section);
    }

    const assistant = assistants[assistants.length - 1];
    if (!assistant) return { waiting: true };

    const copy = detectCopyReadiness(assistant);
    const structuralBlockId = writingBlockStructuralId(assistant);
    // The writing-block body is transferred as the task payload only after local
    // state accepts this DOM candidate. Its text never affects readiness,
    // stability, authorization, duplication or continuation.
    const promptText = copy.writing_block ? sectionWritingBlockText(assistant) : "";
    const payloadExtracted = copy.writing_block === true && typeof promptText === "string" && promptText.length > 0;
    const payloadBytes = payloadExtracted ? new TextEncoder().encode(promptText).byteLength : 0;
    const structuralSignature = writingBlockStructuralSignature(anchorTurnId, assistant, structuralBlockId, copy);

    return {
      anchor_turn_id: anchorTurnId,
      assistant_turn_id: assistant.getAttribute("data-turn-id"),
      prompt_text: promptText,
      payload_extracted: payloadExtracted,
      payload_bytes: payloadBytes,
      payload_extraction_error: payloadExtracted ? "" : (copy.writing_block ? "writing_block_body_not_available" : "writing_block_missing"),
      copy_ready: copy.ready,
      copy_mode: copy.mode,
      writing_block: copy.writing_block,
      prompt_form_reason: copy.writing_block ? "writing_block_present" : "writing_block_missing",
      writing_block_id: structuralBlockId,
      button_snapshot: copy.buttons,
      structural_signature: structuralSignature
    };
  }
  // END EXACT V1.8.37.9 WRITING-BLOCK CAPTURE
  globalThis.BB2ProvenWritingCapture = Object.freeze({
    assistantCandidateAfterAnchor,
    confirmLocalWritingBlockCopyAndExtract,
    detectCopyReadiness,
    sectionWritingBlockText,
    writingBlockStructuralId
  });
})();
