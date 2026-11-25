const titleInput = document.getElementById("title");
const urlOutput = document.getElementById("url");
const selectionInput = document.getElementById("selection");
const selectionChoice = document.querySelector('input[name="titleSource"][value="selection"]');
const projectSelect = document.getElementById("project");
const tagSearch = document.getElementById("tagSearch");
const tagBox = document.getElementById("tagBox");
const tagList = document.getElementById("tagList");
const tagChips = document.getElementById("tagChips");
const submitButton = document.getElementById("submit");
const statusOutput = document.getElementById("status");

let pageTitle = "";
let pageUrl = "";
let activeTabId;
let allTags = [];
const selectedTagIds = new Set();
let visibleTags = [];
let activeTagIndex = -1;
let tagsLoaded = false;
let tagLoadError = "";

initialize().catch((error) => showError(formatError(error)));

document.querySelectorAll('input[name="titleSource"]').forEach((choice) => {
  choice.addEventListener("change", () => {
    if (choice.checked) {
      titleInput.value = choice.value === "selection" ? selectionInput.value : pageTitle;
    }
  });
});

selectionInput.addEventListener("input", () => {
  if (selectionChoice.checked) titleInput.value = selectionInput.value;
});

submitButton.addEventListener("click", submitTask);
titleInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    submitTask();
  }
});
tagSearch.addEventListener("focus", openTagList);
tagBox.addEventListener("click", (event) => {
  if (event.target === tagBox || event.target === tagChips) tagSearch.focus();
});
tagSearch.addEventListener("input", () => {
  activeTagIndex = -1;
  openTagList();
});
tagSearch.addEventListener("keydown", onTagSearchKeydown);
tagSearch.addEventListener("blur", closeTagList);

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  pageTitle = tab?.title || tab?.url || "";
  pageUrl = tab?.url || "";
  titleInput.value = pageTitle;
  urlOutput.textContent = pageUrl;

  if (tab?.id !== undefined) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() || ""
      });
      selectionInput.value = typeof result?.result === "string" ? result.result : "";
      selectionChoice.disabled = !selectionInput.value;
    } catch {
      selectionInput.value = "";
      selectionChoice.disabled = true;
    }
  } else {
    selectionChoice.disabled = true;
  }

  const [projects] = await Promise.all([
    sendMessage({ type: "GET_PROJECTS" }).catch((error) => ({ ok: false, error })),
    loadTags()
  ]);

  if (!projects?.ok) {
    showError(formatError(projects?.error));
    return;
  }
  fillProjects(projects.data);
}

function fillProjects(projects) {
  const visible = (Array.isArray(projects) ? projects : [])
    .filter((project) => project && !project.isArchived && !project.isHiddenFromMenu && !project.isDone);

  for (const project of visible) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.title || "";
    projectSelect.append(option);
  }
}

async function loadTags() {
  try {
    const result = await sendMessage({ type: "GET_TAGS" });
    if (!result.ok) throw result.error;
    fillTags(result.data);
  } catch (error) {
    tagLoadError = formatError(error);
  } finally {
    tagsLoaded = true;
    if (!tagList.hidden) buildTagOptions();
  }
}

function fillTags(tags) {
  allTags = (Array.isArray(tags) ? tags : []).filter((tag) => tag && tag.id);
  if (!tagList.hidden) buildTagOptions();
}

function tagQuery() {
  return tagSearch.value.trim().replace(/^#+/, "").trim();
}

function openTagList() {
  if (tagList.hidden) {
    tagList.hidden = false;
    tagSearch.setAttribute("aria-expanded", "true");
  }
  buildTagOptions();
}

function closeTagList() {
  if (!tagList.hidden) {
    tagList.hidden = true;
    tagSearch.setAttribute("aria-expanded", "false");
  }
  activeTagIndex = -1;
  tagSearch.removeAttribute("aria-activedescendant");
}

function buildTagOptions() {
  const query = tagQuery();
  tagList.textContent = "";
  tagSearch.removeAttribute("aria-activedescendant");
  visibleTags = [];

  if (!tagsLoaded) {
    appendTagNote("Loading tags...");
    return;
  }

  if (tagLoadError) {
    appendTagNote(tagLoadError);
    return;
  }

  visibleTags = allTags
    .filter((tag) => !selectedTagIds.has(tag.id))
    .filter((tag) => !query || tagTitle(tag).toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  if (activeTagIndex >= visibleTags.length) activeTagIndex = visibleTags.length - 1;

  if (!visibleTags.length) {
    if (query) appendTagNote(`No tag named #${query}. Create it in Super Productivity first.`);
    else if (allTags.length) appendTagNote("Every tag is already selected.");
    else appendTagNote("No tags in Super Productivity yet.");
    return;
  }

  visibleTags.forEach((tag, index) => {
    const option = document.createElement("div");
    option.id = `tag-option-${index}`;
    option.className = index === activeTagIndex ? "choice active" : "choice";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === activeTagIndex));
    option.textContent = `#${tagTitle(tag)}`;
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectTag(tag.id);
    });
    tagList.append(option);
    if (index === activeTagIndex) {
      tagSearch.setAttribute("aria-activedescendant", option.id);
    }
  });
}

function appendTagNote(text) {
  const note = document.createElement("div");
  note.className = "empty";
  note.textContent = text;
  tagList.append(note);
}

function onTagSearchKeydown(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (tagList.hidden) {
      openTagList();
      return;
    }
    if (!visibleTags.length) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    if (activeTagIndex < 0) {
      activeTagIndex = event.key === "ArrowDown" ? 0 : visibleTags.length - 1;
    } else {
      activeTagIndex = (activeTagIndex + step + visibleTags.length) % visibleTags.length;
    }
    buildTagOptions();
    return;
  }

  if (event.key === "Enter" && !event.isComposing) {
    if (tagList.hidden) return;
    event.preventDefault();
    const tag = visibleTags[activeTagIndex >= 0 ? activeTagIndex : 0];
    if (tag) selectTag(tag.id);
    return;
  }

  if (event.key === "Escape") {
    closeTagList();
    return;
  }

  if (event.key === "Backspace" && !tagSearch.value) {
    const lastId = [...selectedTagIds].pop();
    if (lastId) {
      event.preventDefault();
      removeTag(lastId);
    }
  }
}

function selectTag(id) {
  selectedTagIds.add(id);
  tagSearch.value = "";
  activeTagIndex = -1;
  renderChips();
  openTagList();
  tagSearch.focus();
}

function removeTag(id) {
  selectedTagIds.delete(id);
  renderChips();
  if (!tagList.hidden) buildTagOptions();
}

function renderChips() {
  tagChips.textContent = "";
  for (const id of selectedTagIds) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", `Remove tag ${findTagTitle(id)}`);
    remove.addEventListener("click", () => removeTag(id));
    chip.append(`#${findTagTitle(id)}`, remove);
    tagChips.append(chip);
  }
}

function tagTitle(tag) {
  return tag.title || tag.id;
}

function findTagTitle(id) {
  const tag = allTags.find((item) => item.id === id);
  return tag ? tagTitle(tag) : id;
}

async function submitTask() {
  if (submitButton.disabled) return;

  const title = titleInput.value.trim();
  if (!title) {
    showError("Enter a task title.");
    titleInput.focus();
    return;
  }

  setBusy(true);
  statusOutput.textContent = "";
  const tagIds = [...selectedTagIds];
  try {
    const result = await sendMessage({
      type: "CREATE_TASK",
      tabId: activeTabId,
      task: {
        title,
        url: pageUrl,
        selectedText: selectionChoice.checked ? "" : selectionInput.value.trim(),
        projectId: projectSelect.value,
        tagIds
      }
    });
    if (!result.ok) throw result.error;
    statusOutput.textContent = "Task added to Super Productivity.";
    statusOutput.style.color = "var(--ok)";
  } catch (error) {
    showError(formatError(error));
  } finally {
    setBusy(false);
  }
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function showError(message) {
  statusOutput.textContent = message;
  statusOutput.style.color = "var(--err)";
}

function formatError(error) {
  if (error?.code === "UNAUTHORIZED" || error?.status === 401) {
    return "Token missing or wrong; copy it from Settings -> Misc.";
  }
  if (error?.code === "FORBIDDEN") {
    return "The app rejected the request. Super Productivity may have changed its API; check for an extension update.";
  }
  if (error?.code === "NETWORK_OR_TIMEOUT") {
    return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
  }
  if (error?.code === "UNKNOWN") return error.message || "Something went wrong.";
  if (error?.code && error?.message) return `${error.code}: ${error.message}`;
  return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? "Adding..." : "Add to Super Productivity";
}
