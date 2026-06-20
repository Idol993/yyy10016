import type { Language } from '@/types'

interface LanguageConfig {
  name: string
  icon: string
  extension: string
  defaultFile: string
  defaultCode: string
  monacoLanguage: string
  runCommand: string
}

export const LANGUAGES: Record<Language, LanguageConfig> = {
  python: {
    name: 'Python',
    icon: '🐍',
    extension: '.py',
    defaultFile: 'main.py',
    defaultCode: 'print("Hello, SandboxOS!")\n',
    monacoLanguage: 'python',
    runCommand: 'python3 main.py',
  },
  nodejs: {
    name: 'Node.js',
    icon: '🟢',
    extension: '.js',
    defaultFile: 'index.js',
    defaultCode: 'console.log("Hello, SandboxOS!");\n',
    monacoLanguage: 'javascript',
    runCommand: 'node index.js',
  },
  cpp: {
    name: 'C++',
    icon: '⚡',
    extension: '.cpp',
    defaultFile: 'main.cpp',
    defaultCode: '#include <iostream>\nint main() {\n    std::cout << "Hello, SandboxOS!" << std::endl;\n    return 0;\n}\n',
    monacoLanguage: 'cpp',
    runCommand: 'g++ -o main main.cpp && ./main',
  },
  rust: {
    name: 'Rust',
    icon: '🦀',
    extension: '.rs',
    defaultFile: 'main.rs',
    defaultCode: 'fn main() {\n    println!("Hello, SandboxOS!");\n}\n',
    monacoLanguage: 'rust',
    runCommand: 'rustc main.rs && ./main',
  },
}
