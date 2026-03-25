import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "lucide-react";
import { ClaudeIcon } from "../icons/ClaudeIcon";
import { useNotificationStore, type BannerToast } from "../../store/notificationStore";
import "./BannerToast.css";

function SessionIcon({ type }: { type: string }) {
  if (type === "claude") return <ClaudeIcon size={12} />;
  return <Terminal size={12} />;
}

function BannerItem({ banner }: { banner: BannerToast }) {
  const [pos, setPos] = useState<{ top?: number; left?: number; right?: number } | null>(null);
  const isPill = banner.placement === "collapsed-pill";

  useEffect(() => {
    const computePosition = () => {
      let el: Element | null = null;

      if (isPill) {
        el = document.querySelector(
          `.pill-item--collapsed[data-session-id="${banner.notification.sessionId}"]`
        );
      }

      if (!el) {
        el = document.querySelector(
          `.projects-rail__icon[data-project-path="${CSS.escape(banner.notification.projectPath)}"]`
        );
      }

      if (el) {
        const rect = el.getBoundingClientRect();
        if (isPill) {
          // Position above the collapsed pill, centered horizontally
          setPos({
            top: rect.top - 8, // banner's bottom edge above the pill (translateY handles rest)
            left: rect.left + rect.width / 2,
          });
        } else {
          // Position to the left of the project icon
          setPos({
            top: rect.top + rect.height / 2 - 20,
            right: window.innerWidth - rect.left + 8,
          });
        }
      }
    };

    computePosition();
    window.addEventListener("resize", computePosition);
    return () => window.removeEventListener("resize", computePosition);
  }, [isPill, banner.notification.sessionId, banner.notification.projectPath]);

  if (!pos) return null;

  const placementClass = isPill ? " banner-toast--pill" : " banner-toast--rail";
  const fadingClass = banner.fading
    ? (isPill ? " banner-toast--fading-up" : " banner-toast--fading")
    : "";

  const style: React.CSSProperties = {
    position: "fixed",
    zIndex: 999,
    ...(isPill
      ? { top: pos.top, left: pos.left, transform: "translate(-50%, -100%)" }
      : { top: pos.top, right: pos.right }),
  };

  return (
    <div className={`banner-toast${placementClass}${fadingClass}`} style={style}>
      <div className="banner-toast__icon">
        <SessionIcon type={banner.notification.sessionType} />
      </div>
      <div className="banner-toast__body">
        <span className="banner-toast__project">{banner.notification.projectName}</span>
        <span className="banner-toast__sep">&rsaquo;</span>
        <span className="banner-toast__type">{banner.notification.sessionType}</span>
      </div>
      <div className="banner-toast__message">{banner.notification.message}</div>
    </div>
  );
}

export function BannerToastContainer() {
  const banners = useNotificationStore((s) => s.banners);

  if (banners.length === 0) return null;

  return createPortal(
    <>
      {banners.map((b) => (
        <BannerItem key={b.id} banner={b} />
      ))}
    </>,
    document.body
  );
}
