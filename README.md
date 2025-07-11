# 🌙 Lunor Language Support – VS Code Extension

**Lunor** is a domain-specific, indentation-based markup language designed to simplify the development of modern web user interfaces. This Visual Studio Code extension adds full language support for Lunor, enabling a smooth development experience directly inside your editor.

Developed as part of a master’s thesis, Lunor combines simplicity, readability, and power – allowing developers to define UI layouts, logic, and content using clean and expressive syntax that compiles into React code.

> 🚀 The goal is to enable **rapid prototyping** and **readable interface definition** without losing the flexibility of modern front-end frameworks.

---

## ✨ Features

### Editor Support via LSP

-   🖍 **Syntax Highlighting**
    Color-coded syntax for `.lnr` files for better readability.

-   ⚠️ **Live Diagnostics**
    Real-time error checking with diagnostic messages powered by the Language Server Protocol (LSP).

-   💡 **Code Actions**
    Inline quick-fix suggestions and improvements for common mistakes or missing attributes.

-   🧠 **Hover Information**
    Context-aware tooltips for built-in directives, expressions, and components.

-   🧩 **Code Completion**
    Smart autocomplete for built-in commands, directive arguments, props, and syntax.

-   🧪 **Symbol Support**
    Symbol tree navigation for easy exploration of components and directives in your Lunor files.

---

## 🛠 Parser and Language Server

-   🔄 **Custom TypeScript Parser**
    Built from scratch to support the indentation-based structure and custom syntax of Lunor.

-   🧱 **AST-Based Code Generation**
    Lunor code is parsed into an Abstract Syntax Tree and then transformed into React components.

-   🔧 **Modular Architecture**
    Designed with extensibility in mind – new directives and components can be added easily.

-   ⚙️ **Wide LSP Implementation**
    The language server supports features such as:
    -   Hover and Completion
    -   Diagnostics and Code Actions
    -   Symbol Trees

---

## 🔗 Integration

Lunor code can be compiled into React JSX and integrated directly into any modern frontend project. It supports Markdown, conditionals (`:if`), loops (`:for`), dynamic data (`:fetch`, `:data`), and reusable components defined in a familiar, readable way.

Example Lunor file:

```lnr
Homepage()

# My Recipe Book

:fetch recipes from "/api/recipes" GET

:for recipe in recipes
  :RecipeCard title={recipe.title} image={recipe.image} link={"/recipes/${recipe.id}"}
```

---

## 🧪 Testing

Some unit tests are already written and more unit and end-to-end tests are planned for future development. The parser and server architecture is designed to be testable independently and integrated into CI/CD workflows.

---

## 📁 Project Structure

-   `/server` – Language Server Protocol implementation
-   `/server/parser` – Custom parser for Lunor syntax (TypeScript)
-   `/client` – VS Code extension interface

---

## 📚 About the Project

This extension and its underlying tooling were developed as part of a master’s thesis focused on domain-specific languages, editor tooling, and code generation. The goal is to demonstrate how a purpose-built language can streamline interface development and editor integration using LSP.

---

## 🧑‍💻 Author

**Mateja**
GitHub: [@matejaz](https://github.com/matejazs)
Project developed as part of master’s thesis – 2025.
