use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=framework=CoreAudio");

    // 目標平台判斷用環境變數（不是 #[cfg]）：build script 跑在 host 上，
    // 交叉編譯 x86_64 macOS 時仍要編出對應 arch 的 Objective-C。
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_apple_speech();
    }

    tauri_build::build()
}

fn build_apple_speech() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => panic!("Unsupported macOS target arch: {other:?}"),
    };

    let object_path = out_dir.join("apple_speech.o");
    let library_path = out_dir.join("libtypek_apple_speech.a");

    run(
        Command::new("xcrun")
            .args(["--sdk", "macosx", "clang", "-c", "-fobjc-arc"])
            .args(["-arch", arch, "-mmacosx-version-min=10.15", "-O2"])
            .arg("native/apple_speech.m")
            .arg("-o")
            .arg(&object_path),
    );

    run(
        Command::new("xcrun")
            .args(["libtool", "-static", "-o"])
            .arg(&library_path)
            .arg(&object_path),
    );

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=typek_apple_speech");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-arg=-Wl,-weak_framework,Speech");
    println!("cargo:rerun-if-changed=native/apple_speech.m");
}

fn run(command: &mut Command) {
    let output = match command.output() {
        Ok(output) => output,
        Err(error) => panic!("Failed to run {command:?}: {error}"),
    };
    if !output.status.success() {
        panic!(
            "Command failed: {command:?}\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }
}
