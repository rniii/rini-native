# Discord (rini native)

1.  Locate and pull the Discord APK

    ```
    % adb shell pm path com.discord
    package:/data/app/.../com.discord-.../base.apk
    package:/data/app/.../com.discord-.../split_config.arm64_v8a.apk
    package:/data/app/.../com.discord-.../split_config.en.apk
    package:/data/app/.../com.discord-.../split_config.xxhdpi.apk
    % adb pull "/data/app/.../com.discord-.../"{base,split_config.{arm64_v8a,en,xxhdpi}}".apk" .
    ```

2.  ???
