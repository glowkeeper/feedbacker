// Share links open the device's own share sheet where the browser has one (phones, and some desktop browsers);
// elsewhere they go to share.html. On share.html, the Copy button copies the address. Nothing is sent anywhere by this.
for (const link of document.querySelectorAll("a[data-share]")) {
  link.addEventListener("click", async (event) => {
    if (!navigator.share) return;
    event.preventDefault();
    try {
      await navigator.share({ title: "Feedbacker", text: "AI-assisted marking and moderation, with educators in control", url: "https://feedbacker.education/" });
    } catch (err) {
      if (err.name !== "AbortError") window.location.href = link.href; // the sheet couldn't open: the share page instead (closing it is AbortError)
    }
  });
}
const copy = document.querySelector("[data-copy]");
if (copy) {
  copy.hidden = false;
  copy.addEventListener("click", async () => {
    const said = document.querySelector("[data-copied]");
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      said.textContent = "Copied the address.";
    } catch {
      said.textContent = "This browser couldn't copy it: select the address and copy it yourself.";
    }
  });
}
