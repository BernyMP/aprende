// The production icon, whatever this build's channel.
import appIconUrl from "../../../../assets/prod/aprende-web-apple-touch-180.png";

export function AppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}
