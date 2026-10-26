import { registerRoot } from "remotion";
import { Composition } from "remotion";
import { WPipeStudioPromo } from "./WPipeStudioPromo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="WPipeStudioPromo"
        component={WPipeStudioPromo}
        durationInFrames={450} // 15 seconds at 30 fps
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

registerRoot(RemotionRoot);
