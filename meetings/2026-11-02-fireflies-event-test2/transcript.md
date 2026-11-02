# fireflies-event-test2

**Meeting Date:** Nov 2, 2026 4:26 PM

---

**Binura Ranasinghe** *[00:01]*: Scratch written in Rust. It's incredibly fast and it's all open source. Today I want to demonstrate the new Agent panel that I'm going to demonstrate it by the Agent panel itself. So here I've got the Z code checked out and I'm asking the agent currently to pass interactions part of the Agent panel right here.

**Binura Ranasinghe** *[00:19]*: Always show the six entries. Please change it. So this number is configurable in the user settings. I'm going to press Enter.

**Binura Ranasinghe** *[00:25]*: And what's happening here is that ZED is sending this prompt over to the large language model. In this particular case, the large language model is Cloud 3.7 Sonnet. I'm using this through Zpro. You can also bring your own API keys.

**Binura Ranasinghe** *[00:34]*: You've got a whole bunch of different options here. And if you want, you can even use Ollama to bring your own model. You can run your own model in your own hardware and use it completely free, no problem at all. Now what's happening here is that we're not, as you can see, doing a chat back and forth.

**Binura Ranasinghe** *[00:47]*: The prompt that I got sent is coming back with tool calls. So this is where Xen has provided a variety of different tools it can use. These are basic editor functionalities, such as searching files, reading files and things like that. And at some point it's going to finish reading through these files, come up with a plan.

**Binura Ranasinghe** *[01:04]*: Let's go ahead and just watch what it's doing when it starts making edits. So I hit follow agent and now what's happening is that we can actually watch it start to do these edits. It's going to hop through the code base and make all these different changes to these different files based on all the context that it loaded up figured out on its own. Nice.

**Binura Ranasinghe** *[01:22]*: This edit seems to have introduced an error. Let's fix it. Now. One of the things that the model has access to is it has access to diagnostics based on the language server.

**Binura Ranasinghe** *[01:30]*: So it received the information that particular edit that it had made, introduced an error and it was able to go back and correct the error. Now this is going to take a good amount of time, so I'm just going to go ahead and let this cook. And while it's working, I'm going to switch to a different window and go do something else. So here I've opened a second ZED window.

**Binura Ranasinghe** *[01:46]*: The other window still got the agent running. So this is one of the nice productivity benefits of having an agent is that it's able to continue making progress on the task while I'M doing something else. This is a blog post with some alt text for its images. So one way I can do this is I can come in here and do an inline assist like so.

**Binura Ranasinghe** *[02:01]*: Very nice. But there are actually a couple of different places in this file that need alt text as well. So I'm just going to open the agent panel and say add alt text to all the images. And this time I'm going to press this suggested context button so that it adds the context of the current file.

**Binura Ranasinghe** *[02:16]*: That way I don't need to wait for it to go and discover files because I know exactly which file it wants working. Once again, I'm going to follow this thing and just see what edits it's making in real time. Very nice, very nice. Now, of course I'm going to want to review all this to make sure that it actually generated reasonable alt text.

**Binura Ranasinghe** *[02:31]*: Nice. We got a little notification telling us that our existing agent is done. So I'm going to go ahead and switch back to there. It looks like it edited three files, so I can expand this.

**Binura Ranasinghe** *[02:40]*: Just see. Okay, there were three different files edited. I can review all these files in one diff. So I open up this review panel, I can immediately hit reject all or keep all.

**Binura Ranasinghe** *[02:48]*: Let me just go ahead and take a glance at what it actually did before. I decide that now sometimes models will do silly things like this. Like I just added a blank line here. No thanks, I'll keep that.

**Binura Ranasinghe** *[02:56]*: As it was. This is a lot more interesting. So now it's actually getting a global setting and using the past interactions count off of that. So I'm going to command click on this.

**Binura Ranasinghe** *[03:04]*: Because this whole hand channel is completely editable. And now I've jumped to here where it actually implemented this thing. So it decided that if the pass interactions count is zero, then it sort of defaults to six. That doesn't seem to be like the right way to implement that default, but it's okay because it's just a completely regular buffer.

**Binura Ranasinghe** *[03:19]*: So I can just delete that. And now it's the way I want it. Okay, let me just jump down to the next change. The next change.

**Binura Ranasinghe** *[03:24]*: Oh, nice. So this is a good example of where agents can be really helpful, especially in comparison to a more deterministic bulk less powerful tools such as language server completions. What happened here is that the agent noticed that one of the things that you have to do when updating settings is that you need to provide an upgrade path for old settings to migrate to new settings. Whenever we introduce something new and Essentially that's what this merge call is doing.

**Binura Ranasinghe** *[03:46]*: And notice this sort of pattern that there's all these other calls to merge elsewhere in the file. That said, you know what, we need to do the same thing for pastinteractionscount. This is really nice because this is something that I could have very easily forgotten to do myself if I were working on this on my own. All right, let's keep going.

**Binura Ranasinghe** *[04:02]*: Okay. Heading field. And we're back to the top. Great.

**Binura Ranasinghe** *[04:06]*: So I'm happy with all this. I'm going to press keep all now we're on to the next file again. Good to me. Nothing else in this file.

**Binura Ranasinghe** *[04:13]*: I'm just going to keep all and I think we're all done. So now I can open up my git diff to see a changes that it made. Just scroll through all this. Looks like I missed one extra comment that we definitely don't need the rest of.

**Binura Ranasinghe** *[04:27]*: This was pretty good to me. There are lots of different ways to get value out of the agent panel. But what I like about this example is that it demonstrates a really common way which is just freeing me up to do something else in a different window while waiting for the agent to write code. And as long as I'm doing a good job reviewing, I can still end up with a very high quality outcome.

**Binura Ranasinghe** *[04:43]*: Check out our website@zed.dev to learn more. Never, I mean never introduce yourself with your name Harry.

