# fireflies-email-test

**Meeting Date:** Nov 2, 2026 4:00 PM

---

**Binura Ranasinghe** *[00:04]*: Before we get started, I want to show you why this video is worth your time and why it's important to be talking about open code right now. Because tools come and go, but momentum and ecosystem usually tells you what's going to stick. I collected these three different screenshots here that really show something interesting. It really shows why open code is worth your time right now.

**Binura Ranasinghe** *[00:24]*: So when we look at cloud code on GitHub, it has around 67,000 stars. But when we look at open code, it has 105,000 stars. In this month alone, it's gotten 36,517 stars on GitHub. Anyways, open code is more popular than COD code.

**Binura Ranasinghe** *[00:43]*: So I think it's safe to say that open code is not just new in China, it's already had in the community adoption signals. But this screenshot here shows the velocity that's happening. So it shows that people are switching, people are making content, building plugins, and the workflow is spreading. So why does this matter?

**Binura Ranasinghe** *[01:01]*: When a tool is moving this fast, you usually get better documentation, more tutorials, more community configurations, and more. I hit this bug and here's the fixed post that makes your learning curve shorter. All right, now that this isn't a random weekend project, let's talk about how open code actually works so the setup makes sense. Let's start first by thinking about what open code really is.

**Binura Ranasinghe** *[01:26]*: So open code is really the open source version of cloud code. So it can do almost everything that cloud code can do. Plus it has an MIT license and is 100% open source. And on top of that, it's provider agnostic.

**Binura Ranasinghe** *[01:42]*: You can use it with cloud, you can use it with OpenAI, you can use it with Google, and you can even use it with local models. This is what I think. If you want flexibility and an open tool that you can shape, open code is probably the better choice. But if you want to go the official anthropic path and you're already standardized, then cloud code may be the better choice for you.

**Binura Ranasinghe** *[02:03]*: The most valuable point on open code is really this, that it's provider agnostic. Because when you think about what just happened, for instance, Anthropic came out with their new AI model, and then so did OpenAI. Anthropic said that this was the most powerful coding model. And then OpenAI came out with one that was actually better for coding, right?

**Binura Ranasinghe** *[02:20]*: The 5.3 Codex. And so it's nice to be able to try them both. To me, this is a really important point, that it's provider agnostic. So you can switch around from different ones.

**Binura Ranasinghe** *[02:32]*: In this video, what I'm going to be showing you guys is how to set up open code windows. We're going to install open code in a Windows friendly way with wsl. We're going to connect models and providers and understand where the credentials live. And I'm going to show you guys how you can use build mode and plan mode effectively and when to switch between them.

**Binura Ranasinghe** *[02:53]*: We're also going to set up some project rules with agents MD and a quick refresher on this as well. And then we'll create. We'll create some skills and commands that will work globally or for rebuild. Why are we going to install it on wsl, really?

**Binura Ranasinghe** *[03:08]*: Because that's what open code recommends for the best performance and terminal compatibility. So I'm not going to walk you guys through how to install wsl, but this is the command that you'll want to use. Just go to your terminal, type in WSL install and then it will work for you. And then we're going to pick it up from right here.

**Binura Ranasinghe** *[03:27]*: We're going to use this command to install open code and then we'll go from there. How should we think about open code? Well, open code is easiest to think of as three layers. First we have the agents layer.

**Binura Ranasinghe** *[03:39]*: Who's doing the work, who's driving? Right now you mainly use the build mode and then the plan mode. The build mode is the do work mode and the plan mode is think safely. If you're new to a code base plan keeps you from letting an agent bulldoze the repo and just run off the rail.

**Binura Ranasinghe** *[03:56]*: Now the second layer is rules. How should the agents behave in this repo? That's the agents md that tells the model your project conventions, structure and do don'ts rules. Think of this as like your onboarding notes for a new teammate.

**Binura Ranasinghe** *[04:13]*: How to run tests, the folder structure, formatting rules, what not to touch, how pull requests and command commits work. Without this you'll end up repeating yourself every prompt. Now the third layer is the extensions. How we automate.

**Binura Ranasinghe** *[04:27]*: Repeatable work skills are the reusable playbooks that the agents can load. And then the commands are like one shot buttons that you can run with a slash name. Whenever you're first getting started with open code, you don't want to over build the giant skills library on day one. You just want to focus on two to three real tasks and then codify what you end up repeating.

**Binura Ranasinghe** *[04:48]*: It's really good to start with a well rounded agent and using the agents effectively the build agent and the plan agent. This is a setup that we're going to have. We're going to use Cursor for editing open code for agent runs in a WSL environment. And now the goal is Cursor is the editor, WSL is the runtime.

**Binura Ranasinghe** *[05:07]*: Opencode runs in WSL and edits the same files that Cursor has open. So the biggest win here is really consistency. One copy of the repo, one set of credentials, and one toolchain. The workflow is going to be like this.

**Binura Ranasinghe** *[05:21]*: We're going to open up the repo in Cursor using the WSL file system integration, open a WSL terminal in that same repo folder, and then run open code from there. Now, a good rule of thumb is if your IDE shows that WSO in the bottom left, then you got your setup properly working. Let's hop over to our file system and open up Cursor and I'll show you guys how to set this up. I'm going to assume that you have WSL installed at the very least.

**Binura Ranasinghe** *[05:48]*: Now, whenever we open up a terminal, we're going to go to the top here and this little arrow that's pointing down, we'll click that, and we can switch to WSL just by hitting this ubuntu. Now we're in our wsl. What we're going to do is we're going to make a new folder for our project. Let's see where we're at right now.

**Binura Ranasinghe** *[06:07]*: We'll go inside of coding projects. Inside of the coding projects, we're going to make a new directory, and we're going to call it Open Codemo. We'll go ahead and change into that directory. Open Codemo.

**Binura Ranasinghe** *[06:20]*: And now we'll just go ahead and run a cursor dot. We're going to open this cursor up inside of this directory. And here at the bottom, you can see it's opening the remote, setting it up. Now we have that going, and there's nothing inside of here yet.

**Binura Ranasinghe** *[06:33]*: Now we need to install open code, and it really doesn't matter in which order you do this. Like, we didn't have to open up the directory before installing open code. I'm just getting it set up so you can do it before. But on the opencode AI docs, it gives us this command to run.

**Binura Ranasinghe** *[06:48]*: We're going to run that. Now it's finished installing, we're going to go ahead and run open code in this directory. Looks like we may need to reset our terminal. I'm just going to copy this and we're going to.

**Binura Ranasinghe** *[07:05]*: Open a new one. You have two options here. You could run the terminal user interface here with a separate window, which is the way that I like to do it, or inside a cursor. I'll show you why I like to have it in a separate window.

**Binura Ranasinghe** *[07:17]*: If we hit Control V, it conflicts when cursor is a little bit harder to use there. That's why I have my separate window open for it. Now that we're inside of OpenCode, what's really nice is that they automatically include free models without us doing anything. You can see we're running on this model here, the Big Pickle from opencode Zen, and we can ask anything, say hello to make sure it's working.

**Binura Ranasinghe** *[07:41]*: Even just for a simple hello, though it took 16 seconds. Just get back, hello. How can I not be able to. Even though OpenCode does include free models, it takes a little while.

**Binura Ranasinghe** *[07:50]*: They're not the best. When we hit Control P, we can see all the different commands that are already built into open code and they're broken down by category. The suggested category for switching sessions, switching models. And they have a few here for free as well.

**Binura Ranasinghe** *[08:06]*: The minimax, the Kimi and the GLM5 and the big Pickle. We can also connect popular providers here. I have the Chat GPT plus plan. We're going to go ahead and select that and we're going to connect it with browser.

