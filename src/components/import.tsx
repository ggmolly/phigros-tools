import { Link } from "@tanstack/react-router";
import { useT } from "../i18n";
import { useSave } from "../save-context";
import { Arrow } from "./arrow";

/** The import methods as arrow rows, shared by the import band and the header's Import dialog.
 * "Local file" clicks the page's one hidden #file input (rendered by the tool layout). */
export function ImportOptions() {
  const { busy, fileInput, openSignIn } = useSave();
  const t = useT();
  const option = (title: string, description: string, onClick: () => void, disabled = false) => (
    <button className="arrow-row import-option" type="button" disabled={disabled} onClick={onClick}>
      <span>
        <strong>{title}</strong>
        <span className="import-description">{description}</span>
      </span>
      <span className="arrow-chip">
        <Arrow />
      </span>
    </button>
  );
  return (
    <>
      {option(t.ppp.profile, t.ppp.profileDesc, () => openSignIn.current?.(), busy)}
      {option(t.import.file, t.import.fileDesc, () => fileInput.current?.click())}
      <Link to="/start" className="arrow-row import-option">
        <span>
          <strong>{t.start.option}</strong>
          <span className="import-description">{t.start.optionDesc}</span>
        </span>
        <span className="arrow-chip">
          <Arrow />
        </span>
      </Link>
    </>
  );
}
