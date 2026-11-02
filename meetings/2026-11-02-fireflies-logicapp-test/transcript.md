# fireflies-logicapp-test

**Meeting Date:** Nov 2, 2026 8:25 AM

---

**Binura Ranasinghe** *[00:09]*: People are going to take you less seriously. Good morning everyone. Stop. Most people, you're probably going to fall into this pro plan, which just $10 per month.

**Binura Ranasinghe** *[00:20]*: If you compare that to Cursor, which I believe is currently $20 per month and this is a pretty good deal. But do keep in mind, if you're just going with the free plan, I probably wouldn't even bother and mess around with the editor, but it's really not useful unless you do have one of these paid plans. In my opinion, it's worth it. This is not sponsored.

**Binura Ranasinghe** *[00:37]*: You can use whatever you want and you can go use Cursor for free if you just want to do the code generation. That said, let's get into the tutorial because this is definitely a cool editor and something that you'll so I just open here and you'll notice that mine probably looks a little bit different than yours. That's because when you download Windsert as it is a fork of VS code, it will ask if you want to import your existing VS code settings. So that's what I did.

**Binura Ranasinghe** *[01:02]*: And I have a theme, I have some extensions. So all of that came in. So it's really nice if you're already a developer working in something like VS code, regardless, the first thing you're going to want to do when you start writing any code is just open some kind of flip. So what I'm going to do is go open folder.

**Binura Ranasinghe** *[01:15]*: I'm going to go to my desktop, I'm just going to make a folder called Test, or of course I already have one called Test. Let's just call it something like Tutorial or Test Tutorial and just put this in a place where you're going to be able to locate it later. Because a lot of beginners make the mistake of not kind of remembering where they saved their code. And then later they turn off the computer, they open it back up again, and they can't find where the project is.

**Binura Ranasinghe** *[01:36]*: So just make sure you put this in a location that you're going to be able to find later on. Now, from here you're going to see immediately that this Cascade window is going to appear. Now, this is Windsurf's version of like Copilot or whatever you want to call it. Cascade.

**Binura Ranasinghe** *[01:48]*: I don't really know the meaning of this name, but the point is, this is what you're going to be using to actually make changes to your code base. Now, this is the main feature. This is what I use probably 90% of the time. So I'm going to Focus on this primary.

**Binura Ranasinghe** *[02:00]*: Now, before you get into actually prompting this and getting it to generate a bunch of code, I do highly recommend that you take a few minutes and generate a little bit of a plan. Just think to yourself what exactly it is that you want to achieve, what you want to build. Maybe draw out a little image of what you expect the user interface to look like. I say that because these AI models can really go down some crazy tangents.

**Binura Ranasinghe** *[02:23]*: And if you don't know exactly what you want it to do, it's going to be very difficult to produce the output that you're looking for. So please just come up with a little bit of a plan. Have an idea of what you want the finished product to look like, and that way this will be a lot more effective for you than if you just go in here and start messing with a bunch of random stuff. It'll take you down all kinds of different avenues that you really don't want to go down.

**Binura Ranasinghe** *[02:42]*: Okay, so we're inside of here and we can just write some kind of prompt here to consider start generating code right away. What you'll notice is that you have this little mode selector here for write and for chat. Now make sure this is in write mode, but again, I believe on the free version it doesn't give you access to this. If you have write mode on, then this is by default going to go and modify a bunch of files for you, maybe create new files for you.

**Binura Ranasinghe** *[03:05]*: It could do a lot of stuff. So if you want to be careful, change it to chat mode. It can still write the code, but it just won't actually apply it to your files. So you have the two different modes.

**Binura Ranasinghe** *[03:15]*: If you're chatting with the code base you use Chat. If you just want some output from the UI that's not related to code, or you don't want it to modify your files, use Chat. If you want to write to your files, obviously use the right super quick pause here. Guys.

**Binura Ranasinghe** *[03:26]*: I promise we'll continue in a second, but I just want to let you know that if you've been watching this channel for a while and you are really looking to level up as a software engineer, I am reopening my mentorship program. It's called Dev Launch. It gives you direct one on one access to myself, where I help guide you to level up as a software engineer. Whether that be what you need to learn next, how to land a job.

**Binura Ranasinghe** *[03:46]*: We've had people come in the program that want to learn how to become an entrepreneur or a freelancer, how to price projects properly. Really anything that you need in the software development industry I can help you with if you're a good fit. So if you are interested, click the link below or go to training.techwithim.net you can apply there. You can see what it's all about and if you're a good fit, then someone from my team will reach out to you with the next steps.

**Binura Ranasinghe** *[04:08]*: Anyways, let's continue and move into the rest of the Bring your idea online with Hostinger's Black Friday sale only now get web hosting for a tutorial. So I just threw a prompt in here and I'm just asking it to make a react application for me that can generate a fun trivia game and we'll save the scores in some kind of file. Now notice that what I did here is I told it the exact framework and languages that I wanted it to use. Now in this case React, it's implicit that you're going to be using JavaScript.

**Binura Ranasinghe** *[04:35]*: But the point is you don't want to just ask this to make some kind of app because then it will just randomly pick the languages or technologies. So you want to at minimum decide what type of frameworks and tech stack you want to use here. So the database, the back end, the front end, what you want to use for a front end framework, if you want to use a CSS styling library or component library. If you know anything about coding, you want to at least make those decisions first before you start going to the so in my case I'm using React and if you don't know what to use, you can change this to chat mode and you can ask it to suggest a tech stack based on what you want to build.

**Binura Ranasinghe** *[05:08]*: But anyways, give it the tech stack, otherwise you're going to be kind of surprised with what it gives you. So I'm going to go ahead and press Enter and you're going to see this kind of kicks into action here and what it's going to start doing is generating a bunch of different files. Now this is really interesting and the first thing just appeared that I was hoping would happen. So notice that Windsurf actually has the ability to add execute terminal commands for you.

**Binura Ranasinghe** *[05:28]*: And because I asked this to make a Vite plus react project, it knows that this is the command that it should be using and it asks if I want to allow it to run the commit. So I'm going to go ahead and press accept and this will actually run it in the terminal for me. Whatever the output of that command is, it can analyze that which is something that's a little bit different from an editor like Cursor. So I'm going to go ahead and press Accept.

**Binura Ranasinghe** *[05:49]*: And if you're curious where this output is actually being ran, if you pull up the bottom tab here where it says terminal, you can actually switch into the different terminals that are running. So you can see that I have this Cascade terminal and if I look in this Cascade terminal, which is the default one here, it shows the command the cascade just ran and then what the output of that command was. So just something to note, if you're looking for where this is actually running, it'll be running in this terminal named Cascade, which you can pull up from the bottom of the page. Okay, so now it's saying, okay, we want to do this, we want to CD and we want to NPM install.

**Binura Ranasinghe** *[06:24]*: Okay, it's saying this doesn't work because we're in PowerShell, so let's run this command. Now it's going to install.

